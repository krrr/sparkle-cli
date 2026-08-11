/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  FunctionCall,
  GenerateContentParameters,
  GenerateContentResponse,
  Tool,
} from '@google/genai';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { LlmRole } from '../telemetry/llmRole.js';
import { toContents } from './partUtils.js';
import {
  FunctionNameMapper,
  MAX_OPENAI_TOOLS,
  OpenAiChunkConverter,
  fingerprintFunctionCalls,
  geminiConfigToOpenAiConfig,
  geminiContentsToOpenAiMessages,
  geminiToolsToOpenAiTools,
  openAiChatCompletionToGeminiResponse,
} from './openAiFormatConverter.js';
import { parseOpenAiSseStream } from './openAiSseParser.js';
import type {
  OpenAiChatCompletion,
  OpenAiEmbeddingsResponse,
  OpenAiErrorResponse,
  OpenAiRequest,
} from './openAiTypes.js';
import { estimateTokenCountSync } from '../utils/tokenCalculation.js';

/** The default OpenAI-compatible API base URL. */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Maximum number of reasoning cache entries (LRU eviction). */
const MAX_REASONING_CACHE_ENTRIES = 200;

/** Known provider prefixes that may be prefixed to a model name. */
const MODEL_PROVIDER_PREFIXES = ['deepseek/', 'openai/'];

/** A list of model prefixes for the model name resolution. */
export type OpenAiProvider = 'openai' | 'deepseek' | 'custom';

/**
 * Error thrown for non-2xx responses from an OpenAI-compatible API.
 * Carries the HTTP status so the shared retry / fallback machinery
 * (isRetryableError, classifyGoogleError) can treat it like other API errors.
 */
export class OpenAiApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'OpenAiApiError';
    this.status = status;
  }
}

export interface OpenAiCompatibleGeneratorConfig {
  apiKey: string;
  /** Base URL, e.g. https://api.openai.com/v1 or https://api.deepseek.com. */
  baseUrl: string;
  provider: OpenAiProvider;
  proxy?: string;
}

/**
 * A ContentGenerator backed by an OpenAI-compatible Chat Completions API
 * (OpenAI, DeepSeek, or any custom compatible endpoint).
 *
 * It translates the Gemini request/response shapes into the OpenAI format:
 * - contents + systemInstruction -> messages
 * - tools -> functions
 * - GenerateContentConfig -> request parameters
 * - SSE stream chunks -> GenerateContentResponse chunks
 *
 * DeepSeek-style reasoning content (`reasoning_content`) is surfaced as
 * Gemini "thought" parts and cached keyed by the fingerprint of the
 * function calls in the turn, so a multi-round tool loop can re-inject the
 * model's previous reasoning on follow-up requests.
 */
export class OpenAiCompatibleGenerator {
  private readonly reasoningCache = new Map<string, string>();
  private readonly functionNameMapper = new FunctionNameMapper();
  private readonly config: OpenAiCompatibleGeneratorConfig;

  constructor(config: OpenAiCompatibleGeneratorConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/+$/, ''),
    };
  }

  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<GenerateContentResponse> {
    const openAiRequest = this.buildOpenAiRequest(request, false);
    const response = await this.postJson(
      '/chat/completions',
      openAiRequest,
      this.getAbortSignal(request),
    );
    if (!response.ok) {
      throw await this.createApiError(response);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const completion = (await response.json()) as OpenAiChatCompletion;
    const geminiResponse = openAiChatCompletionToGeminiResponse(
      completion,
      this.functionNameMapper,
    );

    // Cache reasoning content for reuse in follow-up tool-loop turns.
    const reasoning = completion.choices?.[0]?.message?.reasoning_content;
    const calls = geminiResponse.functionCalls ?? [];
    if (reasoning && calls.length > 0) {
      this.cacheReasoning(calls, reasoning);
    }
    return geminiResponse;
  }

  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const openAiRequest = this.buildOpenAiRequest(request, true);
    const response = await this.postJson(
      '/chat/completions',
      openAiRequest,
      this.getAbortSignal(request),
    );
    if (!response.ok || !response.body) {
      throw await this.createApiError(response);
    }
    const converter = new OpenAiChunkConverter(this.functionNameMapper);
    return this.consumeStream(response.body, converter);
  }

  /**
   * Estimates the token count locally using the shared character-based
   * heuristic (plus an estimate for tools and system instructions), since
   * OpenAI-compatible APIs have no standard countTokens endpoint.
   */
  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    const contents = toContents(request.contents);
    const parts = contents.flatMap((content) => content.parts ?? []);
    let totalTokens = estimateTokenCountSync(parts);

    const config = request.config ?? {};
    const systemText = config.systemInstruction;
    if (systemText !== undefined) {
      totalTokens += Math.floor(JSON.stringify(systemText).length / 4);
    }
    if (config.tools) {
      for (const tool of config.tools) {
        totalTokens += Math.floor(JSON.stringify(tool).length / 4);
      }
    }
    return { totalTokens };
  }

  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    const contents = toContents(request.contents);
    const text = contents
      .flatMap((content) => content.parts ?? [])
      .map((part) => part.text ?? '')
      .join('\n');
    const body = {
      model: this.stripProviderPrefix(request.model),
      input: text,
    };
    const response = await this.postJson(
      '/embeddings',
      body,
      this.getAbortSignal(request),
    );
    if (!response.ok) {
      throw await this.createApiError(response);
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const completion = (await response.json()) as OpenAiEmbeddingsResponse;
    return {
      embeddings: (completion.data ?? []).map((entry) => ({
        values: entry.embedding ?? [],
      })),
    };
  }

  // --- Internals ---

  private buildOpenAiRequest(
    request: GenerateContentParameters,
    streaming: boolean,
  ): OpenAiRequest {
    const contents = toContents(request.contents);
    const config = request.config ?? {};

    const tools = geminiToolsToOpenAiTools(
      this.normalizeTools(config.tools),
      this.functionNameMapper,
    );
    if (tools.length > MAX_OPENAI_TOOLS) {
      throw new Error(
        `The request contains ${tools.length} function tools, but OpenAI-compatible APIs support at most ${MAX_OPENAI_TOOLS}. Disable some tools and try again.`,
      );
    }

    const messages = geminiContentsToOpenAiMessages(contents, {
      systemInstruction: config.systemInstruction,
      reasoningCache: this.reasoningCache,
      nameMapper: this.functionNameMapper,
    });

    const openAiConfig = geminiConfigToOpenAiConfig(
      config,
      this.config.provider,
      this.functionNameMapper,
    );

    return {
      model: this.stripProviderPrefix(request.model),
      messages,
      stream: streaming,
      ...(streaming ? { stream_options: { include_usage: true } } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      ...openAiConfig,
    };
  }

  /**
   * Extracts the plain Tool objects (with functionDeclarations) from the
   * ToolListUnion that may be passed in GenerateContentConfig.tools.
   */
  private normalizeTools(tools: unknown): Tool[] {
    if (!Array.isArray(tools)) {
      return [];
    }
    return tools.filter(
      (tool): tool is Tool =>
        tool !== null &&
        typeof tool === 'object' &&
        'functionDeclarations' in tool,
    );
  }

  /**
   * Strips a known provider prefix (e.g. `deepseek/deepseek-v4-flash` ->
   * `deepseek-v4-flash`) from the model name before sending it to the API.
   */
  private stripProviderPrefix(model: string): string {
    for (const prefix of MODEL_PROVIDER_PREFIXES) {
      if (model.startsWith(prefix)) {
        return model.slice(prefix.length);
      }
    }
    return model;
  }

  private getAbortSignal(request: {
    config?: { httpOptions?: { timeout?: number }; abortSignal?: AbortSignal };
  }): AbortSignal | undefined {
    const abortSignal = request.config?.abortSignal;
    const timeoutMs = request.config?.httpOptions?.timeout;
    if (!abortSignal && timeoutMs === undefined) {
      return undefined;
    }
    const signals: AbortSignal[] = [];
    if (abortSignal) {
      signals.push(abortSignal);
    }
    if (timeoutMs !== undefined && timeoutMs > 0) {
      signals.push(AbortSignal.timeout(timeoutMs));
    }
    return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
  }

  private getEndpointUrl(path: string): string {
    return `${this.config.baseUrl}${path}`;
  }

  private async postJson(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = this.getEndpointUrl(path);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
      'User-Agent': 'SparkleCLI',
    };
    const init: RequestInit & { dispatcher?: unknown } = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    };

    const proxyUrl = this.config.proxy?.trim();
    if (proxyUrl) {
      const agent = url.startsWith('http://')
        ? new HttpProxyAgent(proxyUrl)
        : new HttpsProxyAgent(proxyUrl);
      init.dispatcher = agent;
    }
    return fetch(url, init);
  }

  private async createApiError(response: Response): Promise<OpenAiApiError> {
    const status = response.status;
    let message = `OpenAI-compatible API error (HTTP ${status})`;
    try {
      const text = await response.text();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const parsed = JSON.parse(text) as OpenAiErrorResponse;
      if (parsed.error?.message) {
        message = parsed.error.message;
        if (parsed.error.type) {
          message += ` (${parsed.error.type})`;
        }
      } else if (text) {
        message = text.slice(0, 500);
      }
    } catch {
      // Keep the default message if the body is not JSON.
    }
    return new OpenAiApiError(message, status);
  }

  private async *consumeStream(
    body: ReadableStream<Uint8Array>,
    converter: OpenAiChunkConverter,
  ): AsyncGenerator<GenerateContentResponse> {
    for await (const chunk of parseOpenAiSseStream(body)) {
      yield converter.toGeminiChunk(chunk);
    }
    // Some providers end the stream without a finish reason; flush any
    // accumulated tool calls so the agent loop still sees them.
    const finalChunk = converter.toFinalGeminiChunk();
    if (finalChunk) {
      yield finalChunk;
    }
    // Cache reasoning content keyed by the completed function calls so
    // follow-up tool-loop requests can re-inject it.
    const calls = converter.getCompletedFunctionCalls();
    const reasoning = converter.getReasoningContent();
    if (calls.length > 0 && reasoning) {
      this.cacheReasoning(calls, reasoning);
    }
  }

  private cacheReasoning(calls: FunctionCall[], reasoning: string): void {
    const key = fingerprintFunctionCalls(calls);
    if (!key) {
      return;
    }
    if (this.reasoningCache.size >= MAX_REASONING_CACHE_ENTRIES) {
      // Evict the oldest entry (Map preserves insertion order).
      const oldest = this.reasoningCache.keys().next().value;
      if (oldest !== undefined) {
        this.reasoningCache.delete(oldest);
      }
    }
    this.reasoningCache.set(key, reasoning);
  }
}
