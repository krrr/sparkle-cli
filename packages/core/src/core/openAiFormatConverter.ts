/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FinishReason,
  type Candidate,
  type Content,
  type ContentUnion,
  FunctionCallingConfigMode,
  type GenerateContentConfig,
  GenerateContentResponse,
  type GenerateContentResponseUsageMetadata,
  type Part,
  ThinkingLevel,
  type Tool,
} from '@google/genai';
import { isRecord } from '../utils/markdownUtils.js';
import type {
  OpenAiChatCompletion,
  OpenAiContentPart,
  OpenAiMessage,
  OpenAiRequest,
  OpenAiStreamChunk,
  OpenAiTool,
  OpenAiToolCall,
  OpenAiToolCallDelta,
  OpenAiUsage,
} from './openAiTypes.js';
import stableStringify from 'json-stable-stringify';

/** OpenAI rejects requests with more than 128 function tools. */
export const MAX_OPENAI_TOOLS = 128;

/**
 * Maps Gemini function names to OpenAI-compatible names and back.
 *
 * OpenAI only accepts tool names matching `^[a-zA-Z0-9_-]{1,64}$`, while
 * Gemini tool names (e.g. MCP tools) may contain `/`, `:`, etc. The mapper is
 * stateful: sanitized names must be stable across requests within a session so
 * that function calls, tool responses and history replay stay consistent.
 */
export class FunctionNameMapper {
  private readonly apiToOriginal = new Map<string, string>();
  private readonly originalToApi = new Map<string, string>();

  /** Sanitizes an original Gemini tool name for the OpenAI API. */
  toApiName(original: string): string {
    const existing = this.originalToApi.get(original);
    if (existing) {
      return existing;
    }
    let candidate = sanitizeFunctionName(original);
    const base = candidate;
    let suffix = 1;
    while (
      this.apiToOriginal.has(candidate) &&
      this.apiToOriginal.get(candidate) !== original
    ) {
      candidate = `${base}_${suffix++}`;
    }
    this.apiToOriginal.set(candidate, original);
    this.originalToApi.set(original, candidate);
    return candidate;
  }

  /** Reverses a sanitized API name back to the original Gemini tool name. */
  toOriginalName(apiName: string): string {
    return this.apiToOriginal.get(apiName) ?? apiName;
  }
}

/**
 * Sanitizes a function name so it is valid for the OpenAI API
 * (`^[a-zA-Z0-9_-]{1,64}$`). Returns 'function' if nothing remains.
 */
export function sanitizeFunctionName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return sanitized || 'function';
}

/**
 * Extracts the text from a Gemini system instruction
 * (string | Part | Part[] | Content).
 */
export function extractSystemInstructionText(
  systemInstruction?: ContentUnion,
): string | undefined {
  if (systemInstruction === undefined) {
    return undefined;
  }
  if (typeof systemInstruction === 'string') {
    return systemInstruction;
  }
  if (Array.isArray(systemInstruction)) {
    const text = systemInstruction
      .map((part) => (typeof part === 'string' ? part : (part.text ?? '')))
      .filter(Boolean)
      .join('\n');
    return text || undefined;
  }
  if ('parts' in systemInstruction && Array.isArray(systemInstruction.parts)) {
    const text = systemInstruction.parts
      .map((part) => part.text ?? '')
      .filter(Boolean)
      .join('\n');
    return text || undefined;
  }
  const text =
    'text' in systemInstruction ? (systemInstruction.text ?? '') : '';
  return text || undefined;
}

/**
 * Recursively normalizes a Gemini Schema into a plain JSON Schema object
 * suitable for the OpenAI `response_format.json_schema` parameter.
 * Google enum values for `type` (e.g. "STRING") are lowercased and string
 * numeric fields are converted to numbers.
 */
export function normalizeJsonSchema(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    switch (key) {
      case 'type':
        out['type'] = typeof value === 'string' ? value.toLowerCase() : value;
        break;
      case 'maxItems':
      case 'minItems':
      case 'maxLength':
      case 'minLength':
      case 'maxProperties':
      case 'minProperties': {
        const parsed = typeof value === 'string' ? parseInt(value, 10) : value;
        out[key] = Number.isNaN(parsed) ? undefined : parsed;
        break;
      }
      case 'items':
      case 'anyOf':
        out[key] = Array.isArray(value)
          ? value.map((item) => normalizeJsonSchema(item))
          : normalizeJsonSchema(value);
        break;
      case 'properties':
        out[key] = Object.fromEntries(
          Object.entries(isRecord(value) ? value : {}).map(
            ([propertyKey, propertyValue]) => [
              propertyKey,
              normalizeJsonSchema(propertyValue),
            ],
          ),
        );
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}

/**
 * Converts Gemini tools (function declarations only) into OpenAI tool
 * definitions, sanitizing names through the provided mapper.
 */
export function geminiToolsToOpenAiTools(
  tools: Tool[] | undefined,
  nameMapper: FunctionNameMapper,
): OpenAiTool[] {
  const result: OpenAiTool[] = [];
  for (const tool of tools ?? []) {
    for (const declaration of tool.functionDeclarations ?? []) {
      if (!declaration.name) {
        continue;
      }
      result.push({
        type: 'function',
        function: {
          name: nameMapper.toApiName(declaration.name),
          description: declaration.description,
          parameters: normalizeJsonSchema(
            declaration.parametersJsonSchema ?? declaration.parameters ?? {},
          ),
        },
      });
    }
  }
  return result;
}

/**
 * Extracts the provider-specific `openaiExtraBody` custom field from a
 * GenerateContentConfig (used for arbitrary extra_body passthrough).
 */
export function extractOpenAiExtraBody(
  config: GenerateContentConfig,
): Record<string, unknown> {
  if (!('openaiExtraBody' in config)) {
    return {};
  }
  const extra = config['openaiExtraBody'];
  return isRecord(extra) ? { ...extra } : {};
}

/**
 * Maps a Gemini GenerateContentConfig to the OpenAI request fields.
 *
 * DeepSeek-specific `thinking` (extra_body) and `reasoning_effort` (top-level)
 * fields are only emitted for the deepseek provider, since other
 * OpenAI-compatible APIs reject unknown request fields.
 */
export function geminiConfigToOpenAiConfig(
  config: GenerateContentConfig | undefined,
  provider: string,
  nameMapper?: FunctionNameMapper,
): Partial<OpenAiRequest> {
  if (!config) {
    return {};
  }
  const out: Partial<OpenAiRequest> = {};

  if (config.temperature !== undefined) {
    out.temperature = config.temperature;
  }
  if (config.topP !== undefined) {
    out.top_p = config.topP;
  }
  if (config.maxOutputTokens !== undefined) {
    out.max_tokens = config.maxOutputTokens;
  }
  if (config.stopSequences && config.stopSequences.length > 0) {
    out.stop = [...config.stopSequences];
  }
  if (config.presencePenalty !== undefined) {
    out.presence_penalty = config.presencePenalty;
  }
  if (config.frequencyPenalty !== undefined) {
    out.frequency_penalty = config.frequencyPenalty;
  }
  if (config.seed !== undefined) {
    out.seed = config.seed;
  }

  if (config.responseMimeType === 'application/json') {
    if (config.responseJsonSchema) {
      out.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          schema: normalizeJsonSchema(config.responseJsonSchema),
        },
      };
    } else if (config.responseSchema) {
      out.response_format = {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          schema: normalizeJsonSchema(config.responseSchema),
        },
      };
    } else {
      out.response_format = { type: 'json_object' };
    }
  }

  const callingConfig = config.toolConfig?.functionCallingConfig;
  if (callingConfig?.mode === FunctionCallingConfigMode.NONE) {
    out.tool_choice = 'none';
  } else if (callingConfig?.mode === FunctionCallingConfigMode.ANY) {
    const allowed = callingConfig.allowedFunctionNames;
    if (allowed && allowed.length === 1) {
      // The name must match the sanitized name sent in `tools`, otherwise
      // strict providers reject the request and lenient ones silently ignore
      // the forced tool selection.
      out.tool_choice = {
        type: 'function',
        function: {
          name: nameMapper?.toApiName(allowed[0]) ?? allowed[0],
        },
      };
    } else {
      out.tool_choice = 'required';
    }
  }

  const extraBody: Record<string, unknown> = extractOpenAiExtraBody(config);

  // `reasoning_effort` is a top-level request parameter for both OpenAI and
  // DeepSeek, not an extra_body field. Lift it out of the passthrough.
  const explicitEffort = extraBody['reasoning_effort'];
  if (typeof explicitEffort === 'string' && explicitEffort.length > 0) {
    out.reasoning_effort = explicitEffort;
    delete extraBody['reasoning_effort'];
  }

  const thinking = config.thinkingConfig;
  if (provider === 'deepseek' && thinking) {
    // DeepSeek: thinking is enabled via `extra_body: {"thinking":
    // {"type": "enabled"}}` and the effort level via the top-level
    // `reasoning_effort` parameter (low/high/max). DeepSeek does not support
    // budget_tokens.
    if (
      thinking.includeThoughts === true ||
      thinking.thinkingLevel !== undefined ||
      (thinking.thinkingBudget !== undefined && thinking.thinkingBudget > 0)
    ) {
      extraBody['thinking'] = { type: 'enabled' };
    }
    if (out.reasoning_effort === undefined) {
      if (thinking.thinkingLevel === ThinkingLevel.HIGH) {
        out.reasoning_effort = 'high';
      } else if (thinking.thinkingLevel === ThinkingLevel.LOW) {
        out.reasoning_effort = 'low';
      }
    }
  }
  if (Object.keys(extraBody).length > 0) {
    out.extra_body = extraBody;
  }

  return out;
}

/**
 * Converts Gemini conversation contents into OpenAI messages, prepending the
 * system instruction if present.
 *
 * - Model turns: assistant messages with text, tool_calls, and (when the
 *   reasoning cache has an entry for the turn's function calls) the cached
 *   reasoning content so DeepSeek-style models can resume their chain of
 *   thought across tool-call rounds.
 * - User turns: plain text / multimodal user messages, and tool messages for
 *   function response parts.
 */
export function geminiContentsToOpenAiMessages(
  contents: Content[],
  options: {
    systemInstruction?: ContentUnion;
    nameMapper?: FunctionNameMapper;
  } = {},
): OpenAiMessage[] {
  const messages: OpenAiMessage[] = [];
  const systemText = extractSystemInstructionText(options.systemInstruction);
  if (systemText) {
    messages.push({ role: 'system', content: systemText });
  }

  // Map of tool name -> most recent tool call id, used as a fallback when a
  // function response part has no id of its own.
  const nameToToolCallId = new Map<string, string>();

  for (const content of contents) {
    const parts = content.parts ?? [];
    if (content.role === 'model') {
      const message = modelContentToOpenAiMessage(content, options);
      if (message) {
        for (const call of message.tool_calls ?? []) {
          nameToToolCallId.set(call.function.name, call.id);
        }
        messages.push(message);
      }
    } else if (content.role === 'user') {
      const functionResponses = parts.filter((part) => part.functionResponse);
      const otherParts = parts.filter((part) => !part.functionResponse);
      for (const part of functionResponses) {
        const toolCallId = part.functionResponse!.id;
        const name = part.functionResponse!.name ?? '';
        const mappedName = options.nameMapper
          ? options.nameMapper.toApiName(name)
          : name;
        messages.push({
          role: 'tool',
          content: functionResponseToContent(part.functionResponse!.response),
          tool_call_id:
            toolCallId ??
            nameToToolCallId.get(mappedName) ??
            `call_${messages.length}`,
        });
      }
      if (otherParts.length > 0) {
        messages.push(partsToUserMessage(otherParts));
      }
    }
  }
  return messages;
}

function modelContentToOpenAiMessage(
  content: Content,
  options: {
    nameMapper?: FunctionNameMapper;
  },
): OpenAiMessage | undefined {
  const parts = content.parts ?? [];
  const functionCalls = parts.filter((part) => part.functionCall);
  const text = parts
    .filter(
      (part) =>
        !part.functionCall && !part.thought && typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('');

  const message: OpenAiMessage = {
    role: 'assistant',
    content: text || null,
  };

  if (functionCalls.length > 0) {
    const toolCalls: OpenAiToolCall[] = functionCalls.map((part, index) => {
      const call = part.functionCall!;
      return {
        id: call.id ?? `call_${index}`,
        type: 'function',
        function: {
          name: options.nameMapper
            ? options.nameMapper.toApiName(call.name ?? '')
            : (call.name ?? ''),
          arguments: stableStringify(call.args ?? {})!,
        },
      };
    });
    message.tool_calls = toolCalls;

    // DeepSeek's thinking mode requires the reasoning_content that accompanied
    // a turn's tool calls to be passed back on follow-up requests. Derive it
    // directly from the turn's own thought parts (which are kept in agent
    // history), so no cross-turn cache state is needed. Turns without tool
    // calls is not required to carry reasoning_content.
    const thoughtText = parts
      .filter((part) => part.thought && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    if (thoughtText) {
      message.reasoning_content = thoughtText;
    }
  }

  if (text === '' && functionCalls.length === 0) {
    return undefined;
  }
  return message;
}

function functionResponseToContent(
  response: Record<string, unknown> | undefined,
): string {
  if (response === undefined) {
    return '';
  }
  if (typeof response === 'string') {
    return response;
  }
  return stableStringify(response)!;
}

function partsToUserMessage(parts: Part[]): OpenAiMessage {
  const textParts: string[] = [];
  const contentParts: OpenAiContentPart[] = [];
  for (const part of parts) {
    if (typeof part.text === 'string') {
      textParts.push(part.text);
    } else if (part.inlineData?.data && part.inlineData?.mimeType) {
      contentParts.push({
        type: 'image_url',
        image_url: {
          url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        },
      });
    } else if (
      part.fileData?.fileUri &&
      /^https?:\/\//.test(part.fileData.fileUri)
    ) {
      contentParts.push({
        type: 'image_url',
        image_url: { url: part.fileData.fileUri },
      });
    }
  }

  if (contentParts.length === 0) {
    return { role: 'user', content: textParts.join('\n') || null };
  }
  const content: OpenAiContentPart[] = [];
  if (textParts.length > 0) {
    content.push({ type: 'text', text: textParts.join('\n') });
  }
  content.push(...contentParts);
  return { role: 'user', content };
}

/**
 * Maps an OpenAI finish reason to a Gemini FinishReason.
 */
export function openAiFinishReasonToGemini(
  finishReason?: string | null,
): FinishReason | undefined {
  switch (finishReason) {
    case undefined:
    case null:
      return undefined;
    case 'stop':
    case 'tool_calls':
    case 'function_call':
      return FinishReason.STOP;
    case 'length':
      return FinishReason.MAX_TOKENS;
    case 'content_filter':
      return FinishReason.SAFETY;
    default:
      return FinishReason.OTHER;
  }
}

/**
 * Converts OpenAI usage counters into Gemini usage metadata.
 *
 * Cache token counts are mapped from the provider-specific fields:
 * - DeepSeek: `prompt_cache_hit_tokens`
 * - OpenAI: `prompt_tokens_details.cached_tokens`
 */
export function openAiUsageToGeminiMetadata(
  usage?: OpenAiUsage,
): GenerateContentResponseUsageMetadata | undefined {
  if (!usage) {
    return undefined;
  }
  const metadata: GenerateContentResponseUsageMetadata = {};
  if (usage.prompt_tokens !== undefined) {
    metadata.promptTokenCount = usage.prompt_tokens;
  }
  if (usage.completion_tokens !== undefined) {
    metadata.candidatesTokenCount = usage.completion_tokens;
  }
  if (usage.total_tokens !== undefined) {
    metadata.totalTokenCount = usage.total_tokens;
  } else if (
    usage.prompt_tokens !== undefined &&
    usage.completion_tokens !== undefined
  ) {
    metadata.totalTokenCount = usage.prompt_tokens + usage.completion_tokens;
  }
  const cachedTokens =
    usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens;
  if (cachedTokens !== undefined) {
    metadata.cachedContentTokenCount = cachedTokens;
  }
  return metadata;
}

function parseArgs(argsJson: string): Record<string, unknown> | undefined {
  if (!argsJson) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
    return { value: parsed };
  } catch {
    return undefined;
  }
}

/**
 * Stateful converter that turns an OpenAI SSE stream chunk into a Gemini
 * GenerateContentResponse.
 *
 * OpenAI streams tool call deltas fragmented by index (id / name / argument
 * fragments arrive in separate chunks), while Gemini's SDK delivers fully
 * assembled FunctionCall objects. The converter accumulates deltas and only
 * emits functionCall parts once they are complete (when the finish reason
 * arrives, or via {@link OpenAiChunkConverter.toFinalGeminiChunk} at the end
 * of the stream). This guarantees every tool call is emitted exactly once,
 * which both the GeminiChat context-management path and the legacy path rely
 * on to avoid duplicate tool executions.
 *
 * Reasoning content (`reasoning_content`) is streamed one tiny fragment per
 * chunk, so fragments are likewise buffered and emitted as a single
 * consolidated thought part per reasoning block, matching how Gemini delivers
 * complete thoughts.
 */
export class OpenAiChunkConverter {
  private readonly toolCalls = new Map<
    number,
    { id?: string; name?: string; args: string }
  >();
  private readonly emittedCalls = new Set<number>();
  /** Reasoning fragments received but not yet emitted as a thought part. */
  private pendingReasoning: string[] = [];

  constructor(private readonly nameMapper?: FunctionNameMapper) {}

  toGeminiChunk(chunk: OpenAiStreamChunk): GenerateContentResponse {
    const response = new GenerateContentResponse();
    if (chunk.id) {
      response.responseId = chunk.id;
    }
    if (chunk.model) {
      response.modelVersion = chunk.model;
    }

    const choice = chunk.choices?.[0];
    const delta = choice?.delta;
    const parts: Part[] = [];

    if (delta?.reasoning_content) {
      this.pendingReasoning.push(delta.reasoning_content);
    }

    // OpenAI-compatible APIs stream reasoning content one tiny fragment per
    // SSE chunk. Buffer those fragments and emit a single consolidated thought
    // part when the reasoning block ends (content/tool calls/finish reason
    // arrives, or the stream moves on to another chunk). This mirrors Gemini,
    // which delivers each thought as one complete part. Emitting a part per
    // fragment would turn every reasoning token into its own Thought event and
    // flood the UI with one "thinking" line per token.
    const reasoningEnded =
      !delta?.reasoning_content ||
      (typeof delta?.content === 'string' && delta.content.length > 0) ||
      !!delta?.tool_calls ||
      !!choice?.finish_reason;
    if (reasoningEnded && this.pendingReasoning.length > 0) {
      parts.push({
        text: this.pendingReasoning.join(''),
        thought: true,
      });
      this.pendingReasoning = [];
    }
    if (typeof delta?.content === 'string' && delta.content.length > 0) {
      parts.push({ text: delta.content });
    }
    if (delta?.tool_calls) {
      this.accumulateToolCallDeltas(delta.tool_calls);
    }

    const finishReason = openAiFinishReasonToGemini(choice?.finish_reason);
    if (choice?.finish_reason) {
      this.flushCompletedToolCalls(parts);
    }

    const candidate: Candidate = {};
    if (parts.length > 0) {
      candidate.content = { role: 'model', parts };
    }
    if (finishReason !== undefined) {
      candidate.finishReason = finishReason;
    }
    if (candidate.content || candidate.finishReason) {
      response.candidates = [candidate];
    }

    // Note: `response.functionCalls` is a getter that derives from the
    // candidate parts, so there is nothing to assign here.
    response.usageMetadata = openAiUsageToGeminiMetadata(chunk.usage);
    return response;
  }

  /**
   * Emits a final chunk containing any tool calls that were never flushed by a
   * finish reason (some providers end the stream without one). Returns
   * undefined when there is nothing left to emit.
   */
  toFinalGeminiChunk(): GenerateContentResponse | undefined {
    const parts: Part[] = [];
    // Flush reasoning fragments still buffered (some providers end the stream
    // without a finish reason or a trailing content chunk).
    if (this.pendingReasoning.length > 0) {
      parts.push({
        text: this.pendingReasoning.join(''),
        thought: true,
      });
      this.pendingReasoning = [];
    }
    for (const [index, call] of this.toolCalls) {
      if (this.emittedCalls.has(index) || !call.name) {
        continue;
      }
      this.emittedCalls.add(index);
      parts.push({
        functionCall: {
          name: this.nameMapper?.toOriginalName(call.name) ?? call.name,
          args: parseArgs(call.args),
          id: call.id,
        },
      });
    }
    if (parts.length === 0) {
      return undefined;
    }
    const response = new GenerateContentResponse();
    response.candidates = [{ content: { role: 'model', parts } }];
    return response;
  }

  private accumulateToolCallDeltas(deltas: OpenAiToolCallDelta[]): void {
    for (const delta of deltas) {
      const accumulated = this.toolCalls.get(delta.index) ?? { args: '' };
      if (delta.id) {
        accumulated.id = delta.id;
      }
      if (delta.function?.name) {
        accumulated.name = delta.function.name;
      }
      if (delta.function?.arguments) {
        accumulated.args += delta.function.arguments;
      }
      this.toolCalls.set(delta.index, accumulated);
    }
  }

  private flushCompletedToolCalls(parts: Part[]): void {
    for (const [index, call] of this.toolCalls) {
      if (this.emittedCalls.has(index) || !call.name) {
        continue;
      }
      this.emittedCalls.add(index);
      parts.push({
        functionCall: {
          name: this.nameMapper?.toOriginalName(call.name) ?? call.name,
          args: parseArgs(call.args),
          id: call.id,
        },
      });
    }
  }
}

/**
 * Converts a non-streaming OpenAI Chat Completions response into a single
 * Gemini GenerateContentResponse.
 */
export function openAiChatCompletionToGeminiResponse(
  completion: OpenAiChatCompletion,
  nameMapper?: FunctionNameMapper,
): GenerateContentResponse {
  const response = new GenerateContentResponse();
  if (completion.id) {
    response.responseId = completion.id;
  }
  if (completion.model) {
    response.modelVersion = completion.model;
  }

  const choice = completion.choices?.[0];
  const parts: Part[] = [];
  if (choice?.message?.reasoning_content) {
    parts.push({ text: choice.message.reasoning_content, thought: true });
  }
  if (
    typeof choice?.message?.content === 'string' &&
    choice.message.content.length > 0
  ) {
    parts.push({ text: choice.message.content });
  }

  for (const call of choice?.message?.tool_calls ?? []) {
    parts.push({
      functionCall: {
        name:
          nameMapper?.toOriginalName(call.function.name) ?? call.function.name,
        args: parseArgs(call.function.arguments),
        id: call.id,
      },
    });
  }

  const candidate: Candidate = {};
  if (parts.length > 0) {
    candidate.content = { role: 'model', parts };
  }
  const finishReason = openAiFinishReasonToGemini(choice?.finish_reason);
  if (finishReason !== undefined) {
    candidate.finishReason = finishReason;
  }
  if (candidate.content || candidate.finishReason) {
    response.candidates = [candidate];
  }
  response.usageMetadata = openAiUsageToGeminiMetadata(completion.usage);
  return response;
}
