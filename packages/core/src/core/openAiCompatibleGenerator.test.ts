/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FinishReason, type GenerateContentParameters } from '@google/genai';
import { LlmRole } from '../telemetry/llmRole.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  OpenAiApiError,
  OpenAiCompatibleGenerator,
} from './openAiCompatibleGenerator.js';
import type { OpenAiRequest } from './openAiTypes.js';

interface CapturedRequest {
  path: string;
  body: OpenAiRequest & Record<string, unknown>;
  headers: Record<string, string>;
}

/**
 * A minimal fake OpenAI-compatible server used for integration tests.
 */
class FakeOpenAiServer {
  readonly server: Server;
  private handlers: Array<{
    path: string;
    handler: (
      body: OpenAiRequest & Record<string, unknown>,
      headers: Record<string, string>,
    ) => { status: number; body: string; contentType?: string };
  }> = [];
  captured: CapturedRequest[] = [];

  constructor() {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk.toString()));
      req.on('end', () => {
        const body = JSON.parse(raw || '{}') as OpenAiRequest &
          Record<string, unknown>;
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          headers[key] = String(value);
        }
        this.captured.push({ path: req.url ?? '', body, headers });
        const handler = this.handlers.find((h) => req.url?.startsWith(h.path));
        if (!handler) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'not found' } }));
          return;
        }
        const result = handler.handler(body, headers);
        res.writeHead(result.status, {
          'Content-Type':
            result.contentType ?? 'application/json; charset=utf-8',
        });
        res.end(result.body);
      });
    });
  }

  on(
    path: string,
    handler: (
      body: OpenAiRequest & Record<string, unknown>,
      headers: Record<string, string>,
    ) => { status: number; body: string; contentType?: string },
  ): void {
    this.handlers.push({ path, handler });
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve) =>
      this.server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/v1`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve())),
    );
  }

  get lastRequest(): CapturedRequest | undefined {
    return this.captured[this.captured.length - 1];
  }
}

function createGenerator(baseUrl: string): OpenAiCompatibleGenerator {
  return new OpenAiCompatibleGenerator({
    apiKey: 'test-key',
    baseUrl,
    provider: 'openai',
  });
}

describe('OpenAiCompatibleGenerator', () => {
  let fakeServer: FakeOpenAiServer;
  let baseUrl: string;
  let generator: OpenAiCompatibleGenerator;

  beforeEach(async () => {
    fakeServer = new FakeOpenAiServer();
    baseUrl = await fakeServer.listen();
    generator = createGenerator(baseUrl);
  });

  afterEach(async () => {
    await fakeServer.close();
  });

  describe('generateContent', () => {
    it('sends a non-streaming request and maps the response', async () => {
      fakeServer.on('/v1/chat/completions', (body) => {
        expect(body.stream).toBe(false);
        return {
          status: 200,
          body: JSON.stringify({
            id: 'resp_1',
            model: 'gpt-test',
            choices: [
              {
                message: { role: 'assistant', content: 'Hello world' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          }),
        };
      });

      const response = await generator.generateContent(
        {
          model: 'gpt-test',
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        },
        'prompt-1',
        LlmRole.MAIN,
      );
      expect(response.candidates![0].content!.parts).toEqual([
        { text: 'Hello world' },
      ]);
      expect(response.candidates![0].finishReason).toBe(FinishReason.STOP);
      expect(response.usageMetadata!.totalTokenCount).toBe(8);
      expect(fakeServer.lastRequest!.headers['authorization']).toBe(
        'Bearer test-key',
      );
    });

    it('maps tool calls and reasoning content', async () => {
      fakeServer.on('/v1/chat/completions', () => ({
        status: 200,
        body: JSON.stringify({
          id: 'resp_2',
          model: 'deepseek-v4-flash',
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                reasoning_content: 'I should check the weather',
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'get_weather',
                      arguments: '{"city":"SF"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
      }));

      const response = await generator.generateContent(
        {
          model: 'deepseek-v4-flash',
          contents: [{ role: 'user', parts: [{ text: 'weather?' }] }],
          config: {
            tools: [{ functionDeclarations: [{ name: 'get_weather' }] }],
          },
        },
        'p',
        LlmRole.MAIN,
      );
      expect(response.functionCalls).toEqual([
        { id: 'call_1', name: 'get_weather', args: { city: 'SF' } },
      ]);
      expect(response.candidates![0].content!.parts![0]).toEqual({
        text: 'I should check the weather',
        thought: true,
      });
    });

    it('throws OpenAiApiError with status on non-2xx responses', async () => {
      fakeServer.on('/v1/chat/completions', () => ({
        status: 429,
        body: JSON.stringify({
          error: { message: 'Rate limit exceeded', type: 'rate_limit' },
        }),
      }));
      await expect(
        generator.generateContent(
          { model: 'm', contents: [{ role: 'user', parts: [{ text: 'x' }] }] },
          'p',
          LlmRole.MAIN,
        ),
      ).rejects.toMatchObject({
        name: 'OpenAiApiError',
        status: 429,
        message: expect.stringContaining('Rate limit exceeded'),
      });
    });

    it('respects the abort signal', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        generator.generateContent(
          {
            model: 'm',
            contents: [{ role: 'user', parts: [{ text: 'x' }] }],
            config: { abortSignal: controller.signal },
          },
          'p',
          LlmRole.MAIN,
        ),
      ).rejects.toBeDefined();
    });
  });

  describe('generateContentStream', () => {
    function sseEvents(events: string[]): string {
      return events.map((event) => `data: ${event}\n\n`).join('');
    }

    it('streams chunks and assembles tool calls', async () => {
      fakeServer.on('/v1/chat/completions', (body) => {
        expect(body.stream).toBe(true);
        expect(body.stream_options).toEqual({ include_usage: true });
        return {
          status: 200,
          contentType: 'text/event-stream',
          body: sseEvents([
            JSON.stringify({
              id: 's1',
              model: 'deepseek-v4-flash',
              choices: [{ delta: { reasoning_content: 'thinking' } }],
            }),
            JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_1',
                        function: { name: 'get_weather' },
                      },
                    ],
                  },
                },
              ],
            }),
            JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, function: { arguments: '{"city":"SF"}' } },
                    ],
                  },
                },
              ],
            }),
            JSON.stringify({
              choices: [{ delta: {}, finish_reason: 'tool_calls' }],
            }),
            JSON.stringify({
              choices: [],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 4,
                total_tokens: 14,
              },
            }),
            '[DONE]',
          ]),
        };
      });

      const stream = await generator.generateContentStream(
        {
          model: 'deepseek-v4-flash',
          contents: [{ role: 'user', parts: [{ text: 'weather?' }] }],
        },
        'p',
        LlmRole.MAIN,
      );

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const thoughtChunks = chunks.filter(
        (c) => c.candidates?.[0]?.content?.parts?.[0]?.thought,
      );
      // The reasoning fragment first arrives as a live partial update...
      expect(thoughtChunks).toHaveLength(2);
      expect(thoughtChunks[0].candidates![0].content!.parts![0]).toEqual({
        text: 'thinking',
        thought: true,
        thoughtPartial: true,
      });
      // ...then as the consolidated thought part when the block ends.
      expect(thoughtChunks[1].candidates![0].content!.parts![0]).toEqual({
        text: 'thinking',
        thought: true,
      });

      const functionCalls = chunks
        .flatMap((c) => c.functionCalls ?? [])
        .filter(Boolean);
      expect(functionCalls).toEqual([
        { id: 'call_1', name: 'get_weather', args: { city: 'SF' } },
      ]);

      const usageChunks = chunks.filter((c) => c.usageMetadata);
      expect(usageChunks).toHaveLength(1);
      expect(usageChunks[0].usageMetadata!.totalTokenCount).toBe(14);
    });

    it('derives reasoning_content from the turn thought parts on follow-up requests', async () => {
      const requests: OpenAiRequest[] = [];
      fakeServer.on('/v1/chat/completions', (body) => {
        requests.push(body);
        return {
          status: 200,
          contentType: 'text/event-stream',
          body: sseEvents([
            JSON.stringify({ choices: [{ delta: { content: 'sunny' } }] }),
            JSON.stringify({
              choices: [{ delta: {}, finish_reason: 'stop' }],
            }),
            '[DONE]',
          ]),
        };
      });

      const request: GenerateContentParameters = {
        model: 'deepseek-v4-flash',
        contents: [{ role: 'user', parts: [{ text: 'weather?' }] }],
        config: {
          tools: [{ functionDeclarations: [{ name: 'get_weather' }] }],
        },
      };

      // Follow-up round: history contains the tool-call turn with its thought
      // part; reasoning_content must be derived from the turn itself.
      const stream = await generator.generateContentStream(
        {
          ...request,
          contents: [
            { role: 'user', parts: [{ text: 'weather?' }] },
            {
              role: 'model',
              parts: [
                { text: 'thinking about the weather', thought: true },
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { city: 'SF' },
                    id: 'call_1',
                  },
                },
              ],
            },
            {
              role: 'user',
              parts: [
                {
                  functionResponse: {
                    name: 'get_weather',
                    id: 'call_1',
                    response: { result: 'sunny' },
                  },
                },
              ],
            },
          ],
        },
        'p',
        LlmRole.MAIN,
      );
      for await (const _ of stream) {
        // consume
      }

      const assistantMessage = requests[0].messages.find(
        (m) => m.role === 'assistant' && m.tool_calls,
      );
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage!.reasoning_content).toBe(
        'thinking about the weather',
      );
      expect(assistantMessage!.tool_calls![0].function.name).toBe(
        'get_weather',
      );
    });

    it('throws OpenAiApiError on error responses', async () => {
      fakeServer.on('/v1/chat/completions', () => ({
        status: 401,
        body: JSON.stringify({ error: { message: 'Invalid API key' } }),
      }));
      await expect(
        generator.generateContentStream(
          { model: 'm', contents: [{ role: 'user', parts: [{ text: 'x' }] }] },
          'p',
          LlmRole.MAIN,
        ),
      ).rejects.toBeInstanceOf(OpenAiApiError);
    });
  });

  describe('countTokens', () => {
    it('estimates tokens locally', async () => {
      const result = await generator.countTokens({
        model: 'm',
        contents: [{ role: 'user', parts: [{ text: 'Hello world' }] }],
      });
      expect(result.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('embedContent', () => {
    it('calls the embeddings endpoint and maps the response', async () => {
      fakeServer.on('/v1/embeddings', (body) => {
        expect(body['input']).toBe('text to embed');
        return {
          status: 200,
          body: JSON.stringify({
            data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
            model: 'embed-3',
          }),
        };
      });
      const response = await generator.embedContent({
        model: 'embed-3',
        contents: [{ role: 'user', parts: [{ text: 'text to embed' }] }],
      });
      expect(response.embeddings).toEqual([{ values: [0.1, 0.2, 0.3] }]);
    });
  });
});
