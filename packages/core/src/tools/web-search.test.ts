/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { WebSearchTool, type WebSearchToolParams } from './web-search.js';
import type { Config } from '../config/config.js';
import { GeminiClient } from '../core/client.js';
import { ToolErrorType } from './tool-error.js';
import { createMockMessageBus } from '../test-utils/mock-message-bus.js';
import { ProviderType } from '../config/constants.js';
import { fetchWithTimeout } from '../utils/fetch.js';

// Mock GeminiClient and Config constructor
vi.mock('../core/client.js');
vi.mock('../config/config.js');

vi.mock('../utils/fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/fetch.js')>();
  return { ...actual, fetchWithTimeout: vi.fn() };
});

function mockExaResponse(results: Array<Record<string, unknown>>) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ requestId: 'test', results }),
  };
}

describe('WebSearchTool', () => {
  const abortSignal = new AbortController().signal;
  let mockGeminiClient: GeminiClient;
  let tool: WebSearchTool;
  let mockConfigInstance: {
    getContentGeneratorConfig: Mock;
    getWebSearchConfig: Mock;
    [key: string]: unknown;
  };

  beforeEach(() => {
    mockConfigInstance = {
      getGeminiClient: () => mockGeminiClient,
      get geminiClient() {
        return mockGeminiClient;
      },
      getProxy: () => undefined,
      getContentGeneratorConfig: vi.fn(() => ({
        authType: ProviderType.USE_GEMINI,
      })),
      getWebSearchConfig: vi.fn(() => undefined),
      generationConfigService: {
        getResolvedConfig: vi.fn().mockImplementation(({ model }) => ({
          model,
          sdkConfig: {},
        })),
      },
    } as unknown as {
      getContentGeneratorConfig: Mock;
      getWebSearchConfig: Mock;
      [key: string]: unknown;
    };
    (
      mockConfigInstance as unknown as { config: Config; promptId: string }
    ).config = mockConfigInstance as unknown as Config;
    (
      mockConfigInstance as unknown as { config: Config; promptId: string }
    ).promptId = 'test-prompt-id';
    mockGeminiClient = new GeminiClient(
      mockConfigInstance as unknown as Config,
    );
    tool = new WebSearchTool(
      mockConfigInstance as unknown as Config,
      createMockMessageBus(),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('build', () => {
    it('should return an invocation for a valid query', () => {
      const params: WebSearchToolParams = { query: 'test query' };
      const invocation = tool.build(params);
      expect(invocation).toBeDefined();
      expect(invocation.params).toEqual(params);
    });

    it('should throw an error for an empty query', () => {
      const params: WebSearchToolParams = { query: '' };
      expect(() => tool.build(params)).toThrow(
        "The 'query' parameter cannot be empty.",
      );
    });

    it('should throw an error for a query with only whitespace', () => {
      const params: WebSearchToolParams = { query: '   ' };
      expect(() => tool.build(params)).toThrow(
        "The 'query' parameter cannot be empty.",
      );
    });
  });

  describe('getDescription', () => {
    it('should return a description of the search', () => {
      const params: WebSearchToolParams = { query: 'test query' };
      const invocation = tool.build(params);
      expect(invocation.getDescription()).toBe(
        'Searching the web for: "test query"',
      );
    });
  });

  describe('execute', () => {
    it('should return search results for a successful query', async () => {
      const params: WebSearchToolParams = { query: 'successful query' };
      (mockGeminiClient.generateContent as Mock).mockResolvedValue({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Here are your results.' }],
            },
          },
        ],
      });

      const invocation = tool.build(params);
      const result = await invocation.execute({ abortSignal });

      expect(result.llmContent).toBe(
        'Web search results for "successful query":\n\nHere are your results.',
      );
      expect(result.returnDisplay).toBe(
        'Search results for "successful query" returned.',
      );
      expect(result.sources).toBeUndefined();
    });

    it('should handle no search results found', async () => {
      const params: WebSearchToolParams = { query: 'no results query' };
      (mockGeminiClient.generateContent as Mock).mockResolvedValue({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: '' }],
            },
          },
        ],
      });

      const invocation = tool.build(params);
      const result = await invocation.execute({ abortSignal });

      expect(result.llmContent).toBe(
        'No search results or information found for query: "no results query"',
      );
      expect(result.returnDisplay).toBe('No information found.');
    });

    it('should return a WEB_SEARCH_FAILED error on failure', async () => {
      const params: WebSearchToolParams = { query: 'error query' };
      const testError = new Error('API Failure');
      (mockGeminiClient.generateContent as Mock).mockRejectedValue(testError);

      const invocation = tool.build(params);
      const result = await invocation.execute({ abortSignal });

      expect(result.error?.type).toBe(ToolErrorType.WEB_SEARCH_FAILED);
      expect(result.llmContent).toContain('Error:');
      expect(result.llmContent).toContain('API Failure');
      expect(result.returnDisplay).toBe('Error performing web search.');
    });

    it('should correctly format results with sources and citations', async () => {
      const params: WebSearchToolParams = { query: 'grounding query' };
      (mockGeminiClient.generateContent as Mock).mockResolvedValue({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'This is a test response.' }],
            },
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: 'https://example.com', title: 'Example Site' } },
                { web: { uri: 'https://google.com', title: 'Google' } },
              ],
              groundingSupports: [
                {
                  segment: { startIndex: 5, endIndex: 14 },
                  groundingChunkIndices: [0],
                },
                {
                  segment: { startIndex: 15, endIndex: 24 },
                  groundingChunkIndices: [0, 1],
                },
              ],
            },
          },
        ],
      });

      const invocation = tool.build(params);
      const result = await invocation.execute({ abortSignal });

      const expectedLlmContent = `Web search results for "grounding query":

This is a test[1] response.[1][2]

Sources:
[1] Example Site (https://example.com)
[2] Google (https://google.com)`;

      expect(result.llmContent).toBe(expectedLlmContent);
      expect(result.returnDisplay).toBe(
        'Search results for "grounding query" returned.',
      );
      expect(result.sources).toHaveLength(2);
    });

    it('should insert markers at correct byte positions for multibyte text', async () => {
      const params: WebSearchToolParams = { query: 'multibyte query' };
      (mockGeminiClient.generateContent as Mock).mockResolvedValue({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'こんにちは! Sparkle CLI✨️' }],
            },
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    title: 'Japanese Greeting',
                    uri: 'https://example.test/japanese-greeting',
                  },
                },
                {
                  web: {
                    title: 'google-gemini/gemini-cli',
                    uri: 'https://github.com/krrr/sparkle-cli',
                  },
                },
                {
                  web: {
                    title: 'Sparkle CLI: your open-source AI agent',
                    uri: 'https://blog.google/technology/developers/introducing-gemini-cli-open-source-ai-agent/',
                  },
                },
              ],
              groundingSupports: [
                {
                  segment: {
                    // Byte range of "こんにちは!" (utf-8 encoded)
                    startIndex: 0,
                    endIndex: 16,
                  },
                  groundingChunkIndices: [0],
                },
                {
                  segment: {
                    // Byte range of "Sparkle CLI✨️" (utf-8 encoded)
                    startIndex: 17,
                    endIndex: 34,
                  },
                  groundingChunkIndices: [1, 2],
                },
              ],
            },
          },
        ],
      });

      const invocation = tool.build(params);
      const result = await invocation.execute({ abortSignal });

      const expectedLlmContent = `Web search results for "multibyte query":

こんにちは![1] Sparkle CLI✨️[2][3]

Sources:
[1] Japanese Greeting (https://example.test/japanese-greeting)
[2] google-gemini/gemini-cli (https://github.com/krrr/sparkle-cli)
[3] Sparkle CLI: your open-source AI agent (https://blog.google/technology/developers/introducing-gemini-cli-open-source-ai-agent/)`;

      expect(result.llmContent).toBe(expectedLlmContent);
      expect(result.returnDisplay).toBe(
        'Search results for "multibyte query" returned.',
      );
      expect(result.sources).toHaveLength(3);
    });
  });

  describe('execute with non-Gemini provider', () => {
    beforeEach(() => {
      mockConfigInstance.getContentGeneratorConfig.mockReturnValue({
        authType: ProviderType.USE_OPENAI,
      });
    });

    it('should use the configured third-party provider and skip the Gemini path', async () => {
      mockConfigInstance.getWebSearchConfig.mockReturnValue({
        thirdPartyProvider: 'exa',
        apiKey: 'test-key',
      });
      (fetchWithTimeout as Mock).mockResolvedValue(
        mockExaResponse([
          {
            title: 'Exa Result',
            url: 'https://exa.example/result',
            publishedDate: '2026-01-15',
            highlights: ['key point one', 'key point two'],
          },
          {
            title: 'Another Result',
            url: 'https://another.example',
            highlights: [],
          },
        ]),
      );

      const invocation = tool.build({ query: 'exa query' });
      const result = await invocation.execute({ abortSignal });

      expect(mockGeminiClient.generateContent).not.toHaveBeenCalled();
      expect(result.returnDisplay).toBe(
        'Search results for "exa query" returned.',
      );
      expect(result.llmContent).toContain(
        '[1] Exa Result (https://exa.example/result)',
      );
      expect(result.llmContent).toContain('Published: 2026-01-15');
      expect(result.llmContent).toContain('- key point one');
      expect(result.llmContent).toContain(
        '[2] Another Result (https://another.example)',
      );
      expect(result.sources).toEqual([
        { web: { uri: 'https://exa.example/result', title: 'Exa Result' } },
        { web: { uri: 'https://another.example', title: 'Another Result' } },
      ]);
    });

    it('should report no results when the third-party provider returns none', async () => {
      mockConfigInstance.getWebSearchConfig.mockReturnValue({
        thirdPartyProvider: 'exa',
        apiKey: 'test-key',
      });
      (fetchWithTimeout as Mock).mockResolvedValue(mockExaResponse([]));

      const invocation = tool.build({ query: 'empty query' });
      const result = await invocation.execute({ abortSignal });

      expect(result.llmContent).toBe(
        'No search results or information found for query: "empty query"',
      );
      expect(result.returnDisplay).toBe('No information found.');
    });

    it('should return a configuration error when no provider is configured', async () => {
      const invocation = tool.build({ query: 'unconfigured query' });
      const result = await invocation.execute({ abortSignal });

      expect(mockGeminiClient.generateContent).not.toHaveBeenCalled();
      expect(fetchWithTimeout).not.toHaveBeenCalled();
      expect(result.error?.type).toBe(ToolErrorType.WEB_SEARCH_FAILED);
      expect(result.llmContent).toContain(
        'does not support Google Search grounding',
      );
      expect(result.llmContent).toContain('tools.webSearch.thirdPartyProvider');
      expect(result.returnDisplay).toBe('Web search is not configured.');
    });

    it('should return a WEB_SEARCH_FAILED error when the provider request fails', async () => {
      mockConfigInstance.getWebSearchConfig.mockReturnValue({
        thirdPartyProvider: 'exa',
        apiKey: 'test-key',
      });
      (fetchWithTimeout as Mock).mockRejectedValue(
        new Error('Exa search request failed with status 401 Unauthorized'),
      );

      const invocation = tool.build({ query: 'failing query' });
      const result = await invocation.execute({ abortSignal });

      expect(result.error?.type).toBe(ToolErrorType.WEB_SEARCH_FAILED);
      expect(result.llmContent).toContain('exa');
      expect(result.llmContent).toContain('401');
      expect(result.returnDisplay).toBe('Error performing web search.');
    });
  });
});
