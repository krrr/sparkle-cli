/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { WEB_SEARCH_TOOL_NAME, WEB_SEARCH_DISPLAY_NAME } from './tool-names.js';
import type { GroundingMetadata } from '@google/genai';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
  type ExecuteOptions,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';

import { getErrorMessage, isAbortError } from '../utils/errors.js';
import { getResponseText } from '../utils/partUtils.js';
import { debugLogger } from '../utils/debugLogger.js';
import { WEB_SEARCH_DECLARATION } from './definitions/coreTools.js';
import { LlmRole } from '../telemetry/llmRole.js';
import type { AgentLoopContext } from '../config/agent-loop-context.js';
import { ProviderType } from '../config/constants.js';
import {
  formatThirdPartySearchResults,
  resolveThirdPartySearchProvider,
} from './websearch/third-party-search.js';

interface GroundingChunkWeb {
  uri?: string;
  title?: string;
}

interface GroundingChunkItem {
  web?: GroundingChunkWeb;
  // Other properties might exist if needed in the future
}

interface GroundingSupportSegment {
  startIndex: number;
  endIndex: number;
  text?: string; // text is optional as per the example
}

interface GroundingSupportItem {
  segment?: GroundingSupportSegment;
  groundingChunkIndices?: number[];
  confidenceScores?: number[]; // Optional as per example
}

/**
 * Parameters for the WebSearchTool.
 */
export interface WebSearchToolParams {
  /**
   * The search query.
   */

  query: string;
}

/**
 * Extends ToolResult to include sources for web search.
 */
export interface WebSearchToolResult extends ToolResult {
  sources?: GroundingMetadata extends { groundingChunks: GroundingChunkItem[] }
    ? GroundingMetadata['groundingChunks']
    : GroundingChunkItem[];
}

class WebSearchToolInvocation extends BaseToolInvocation<
  WebSearchToolParams,
  WebSearchToolResult
> {
  constructor(
    private readonly context: AgentLoopContext,
    params: WebSearchToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  override getDescription(): string {
    return `Searching the web for: "${this.params.query}"`;
  }

  async execute({
    abortSignal: signal,
  }: ExecuteOptions): Promise<WebSearchToolResult> {
    // The primary search path relies on the Gemini API's Google Search
    // grounding, which is not available to non-Gemini providers (the
    // googleSearch tool parameter is dropped there). Use the configured
    // third-party search API in that case.
    const authType = this.context.config.getContentGeneratorConfig()?.authType;
    if (authType !== undefined && authType !== ProviderType.USE_GEMINI) {
      return this.executeThirdPartySearch(signal);
    }

    const geminiClient = this.context.geminiClient;

    try {
      const response = await geminiClient.generateContent(
        { model: 'web-search' },
        [{ role: 'user', parts: [{ text: this.params.query }] }],
        signal,
        LlmRole.UTILITY_TOOL,
      );

      const responseText = getResponseText(response);
      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      const sources = groundingMetadata?.groundingChunks as
        | GroundingChunkItem[]
        | undefined;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      const groundingSupports = groundingMetadata?.groundingSupports as
        | GroundingSupportItem[]
        | undefined;

      if (!responseText || !responseText.trim()) {
        return {
          llmContent: `No search results or information found for query: "${this.params.query}"`,
          returnDisplay: 'No information found.',
        };
      }

      let modifiedResponseText = responseText;
      const sourceListFormatted: string[] = [];

      if (sources && sources.length > 0) {
        sources.forEach((source: GroundingChunkItem, index: number) => {
          const title = source.web?.title || 'Untitled';
          const uri = source.web?.uri || 'No URI';
          sourceListFormatted.push(`[${index + 1}] ${title} (${uri})`);
        });

        if (groundingSupports && groundingSupports.length > 0) {
          const insertions: Array<{ index: number; marker: string }> = [];
          groundingSupports.forEach((support: GroundingSupportItem) => {
            if (support.segment && support.groundingChunkIndices) {
              const citationMarker = support.groundingChunkIndices
                .map((chunkIndex: number) => `[${chunkIndex + 1}]`)
                .join('');
              insertions.push({
                index: support.segment.endIndex,
                marker: citationMarker,
              });
            }
          });

          // Sort insertions by index in descending order to avoid shifting subsequent indices
          insertions.sort((a, b) => b.index - a.index);

          // Use TextEncoder/TextDecoder since segment indices are UTF-8 byte positions
          const encoder = new TextEncoder();
          const responseBytes = encoder.encode(modifiedResponseText);
          const parts: Uint8Array[] = [];
          let lastIndex = responseBytes.length;
          for (const ins of insertions) {
            const pos = Math.min(ins.index, lastIndex);
            parts.unshift(responseBytes.subarray(pos, lastIndex));
            parts.unshift(encoder.encode(ins.marker));
            lastIndex = pos;
          }
          parts.unshift(responseBytes.subarray(0, lastIndex));

          // Concatenate all parts into a single buffer
          const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
          const finalBytes = new Uint8Array(totalLength);
          let offset = 0;
          for (const part of parts) {
            finalBytes.set(part, offset);
            offset += part.length;
          }
          modifiedResponseText = new TextDecoder().decode(finalBytes);
        }

        if (sourceListFormatted.length > 0) {
          modifiedResponseText +=
            '\n\nSources:\n' + sourceListFormatted.join('\n');
        }
      }

      return {
        llmContent: `Web search results for "${this.params.query}":\n\n${modifiedResponseText}`,
        returnDisplay: `Search results for "${this.params.query}" returned.`,
        sources,
      };
    } catch (error: unknown) {
      if (isAbortError(error)) {
        return {
          llmContent: 'Web search was cancelled.',
          returnDisplay: 'Search cancelled.',
        };
      }
      const errorMessage = `Error during web search for query "${
        this.params.query
      }": ${getErrorMessage(error)}`;
      debugLogger.warn(errorMessage, error);
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error performing web search.`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_SEARCH_FAILED,
        },
      };
    }
  }

  private async executeThirdPartySearch(
    signal: AbortSignal,
  ): Promise<WebSearchToolResult> {
    const resolution = resolveThirdPartySearchProvider(this.context.config);
    if (!resolution.provider) {
      const message = `Web search is unavailable: the active provider does not support Google Search grounding. ${resolution.reason}`;
      debugLogger.warn(message);
      return {
        llmContent: `Error: ${message}`,
        returnDisplay: 'Web search is not configured.',
        error: {
          message,
          type: ToolErrorType.WEB_SEARCH_FAILED,
        },
      };
    }

    try {
      const results = await resolution.provider.search(
        this.params.query,
        signal,
      );
      if (results.length === 0) {
        return {
          llmContent: `No search results or information found for query: "${this.params.query}"`,
          returnDisplay: 'No information found.',
        };
      }
      return {
        llmContent: `Web search results for "${this.params.query}":\n\n${formatThirdPartySearchResults(results)}`,
        returnDisplay: `Search results for "${this.params.query}" returned.`,
        sources: results.map((result) => ({
          web: { uri: result.url, title: result.title },
        })),
      };
    } catch (error: unknown) {
      if (isAbortError(error)) {
        return {
          llmContent: 'Web search was cancelled.',
          returnDisplay: 'Search cancelled.',
        };
      }
      const errorMessage = `Error during ${resolution.provider.name} web search for query "${this.params.query}": ${getErrorMessage(error)}`;
      debugLogger.warn(errorMessage, error);
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error performing web search.`,
        error: {
          message: errorMessage,
          type: ToolErrorType.WEB_SEARCH_FAILED,
        },
      };
    }
  }
}

/**
 * A tool to perform web searches using Google Search via the Gemini API.
 */
export class WebSearchTool extends BaseDeclarativeTool<
  WebSearchToolParams,
  WebSearchToolResult
> {
  static readonly Name = WEB_SEARCH_TOOL_NAME;

  constructor(
    private readonly context: AgentLoopContext,
    messageBus: MessageBus,
  ) {
    super(
      WebSearchTool.Name,
      WEB_SEARCH_DISPLAY_NAME,
      WEB_SEARCH_DECLARATION.description!,
      Kind.Search,
      WEB_SEARCH_DECLARATION.parametersJsonSchema,
      messageBus,
      true, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  /**
   * Validates the parameters for the WebSearchTool.
   * @param params The parameters to validate
   * @returns An error message string if validation fails, null if valid
   */
  protected override validateToolParamValues(
    params: WebSearchToolParams,
  ): string | null {
    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }
    return null;
  }

  protected createInvocation(
    params: WebSearchToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<WebSearchToolParams, WebSearchToolResult> {
    return new WebSearchToolInvocation(
      this.context.config,
      params,
      messageBus ?? this.messageBus,
      _toolName,
      _toolDisplayName,
    );
  }

  override getSchema(_modelId?: string) {
    return WEB_SEARCH_DECLARATION;
  }
}
