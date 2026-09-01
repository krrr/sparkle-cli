/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  Content,
  GenerateContentParameters,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
} from '@google/genai';
import { GoogleGenAiContentGenerator } from './googleGenAiContentGenerator.js';
import { LlmRole } from '../telemetry/llmRole.js';
import { SYNTHETIC_THOUGHT_SIGNATURE } from '../utils/historyHardening.js';

describe('GoogleGenAiContentGenerator', () => {
  const mockModels: GoogleGenAI['models'] = {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn(),
    embedContent: vi.fn(),
  } as unknown as GoogleGenAI['models'];

  const generator = new GoogleGenAiContentGenerator(mockModels);

  it('strips thought parts and injects thoughtSignature on active tool calls in generateContent', async () => {
    const fakeResponse = {
      candidates: [{ content: { role: 'model', parts: [{ text: 'done' }] } }],
    } as unknown as GenerateContentResponse;
    vi.mocked(mockModels.generateContent).mockResolvedValue(fakeResponse);

    const contents: Content[] = [
      {
        role: 'user',
        parts: [{ text: 'do something' }],
      },
      {
        role: 'model',
        parts: [
          { text: 'thinking...', thought: true } as unknown as Part,
          { functionCall: { name: 'my_tool', args: { x: 1 } } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'my_tool', response: { result: 'ok' } } },
        ],
      },
    ];

    const request: GenerateContentParameters = {
      model: 'gemini-2.5-pro',
      contents,
    };

    const res = await generator.generateContent(
      request,
      'prompt-1',
      LlmRole.MAIN,
    );
    expect(res).toBe(fakeResponse);

    expect(mockModels.generateContent).toHaveBeenCalledTimes(1);
    const passedReq = vi.mocked(mockModels.generateContent).mock.calls[0][0];
    const passedContents = passedReq.contents as Content[];

    // 1. Thought part should be stripped
    expect(passedContents[1].parts?.some((p) => p.thought)).toBe(false);
    // 2. Active loop function call should have thoughtSignature injected
    expect(passedContents[1].parts?.[0].functionCall?.name).toBe('my_tool');
    expect(passedContents[1].parts?.[0].thoughtSignature).toBe(
      SYNTHETIC_THOUGHT_SIGNATURE,
    );
  });

  it('strips thought parts and scrubs properties in generateContentStream', async () => {
    async function* fakeStream() {
      yield {
        candidates: [
          { content: { role: 'model', parts: [{ text: 'chunk' }] } },
        ],
      } as unknown as GenerateContentResponse;
    }
    vi.mocked(mockModels.generateContentStream).mockResolvedValue(fakeStream());

    const contents: Content[] = [
      {
        role: 'user',
        parts: [{ text: 'hello' }],
      },
      {
        role: 'model',
        parts: [
          { text: 'internal monologue', thought: true } as unknown as Part,
          { text: 'Hello! How can I help you?' },
        ],
      },
      {
        role: 'user',
        parts: [{ text: 'next question' }],
      },
    ];

    const request: GenerateContentParameters = {
      model: 'gemini-2.5-pro',
      contents,
    };

    const stream = await generator.generateContentStream(
      request,
      'prompt-2',
      LlmRole.MAIN,
    );
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);

    const passedReq = vi.mocked(mockModels.generateContentStream).mock
      .calls[0][0];
    const passedContents = passedReq.contents as Content[];
    expect(passedContents[1].parts).toHaveLength(1);
    expect(passedContents[1].parts?.[0]).toEqual({
      text: 'Hello! How can I help you?',
    });
  });

  it('prepares contents for countTokens', async () => {
    vi.mocked(mockModels.countTokens).mockResolvedValue({ totalTokens: 42 });

    const contents: Content[] = [
      {
        role: 'user',
        parts: [{ text: 'hello' }],
      },
      {
        role: 'model',
        parts: [
          { text: 'thinking...', thought: true } as unknown as Part,
          { text: 'world' },
        ],
      },
    ];

    const res = await generator.countTokens({
      model: 'gemini-2.5-pro',
      contents,
    });

    expect(res.totalTokens).toBe(42);
    const passedReq = vi.mocked(mockModels.countTokens).mock.calls[0][0];
    const passedContents = passedReq.contents as Content[];
    expect(passedContents[1].parts).toEqual([{ text: 'world' }]);
  });

  it('passes embedContent directly to models', async () => {
    vi.mocked(mockModels.embedContent).mockResolvedValue({
      embeddings: [{ values: [0.1, 0.2] }],
    });

    const res = await generator.embedContent({
      model: 'text-embedding-004',
      contents: [{ role: 'user', parts: [{ text: 'embed this' }] }],
    });

    expect(res.embeddings?.[0]?.values).toEqual([0.1, 0.2]);
  });
});
