/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FinishReason,
  FunctionCallingConfigMode,
  ThinkingLevel,
  type GenerateContentConfig,
  type Schema,
} from '@google/genai';
import { describe, expect, it } from 'vitest';
import {
  FunctionNameMapper,
  OpenAiChunkConverter,
  extractSystemInstructionText,
  fingerprintFunctionCalls,
  geminiConfigToOpenAiConfig,
  geminiContentsToOpenAiMessages,
  geminiToolsToOpenAiTools,
  normalizeJsonSchema,
  openAiChatCompletionToGeminiResponse,
  openAiFinishReasonToGemini,
  openAiUsageToGeminiMetadata,
  sanitizeFunctionName,
  stableStringify,
} from './openAiFormatConverter.js';
import type {
  OpenAiChatCompletion,
  OpenAiStreamChunk,
  OpenAiUsage,
} from './openAiTypes.js';

describe('extractSystemInstructionText', () => {
  it('returns strings as-is', () => {
    expect(extractSystemInstructionText('Be helpful')).toBe('Be helpful');
  });

  it('joins text from part arrays', () => {
    expect(extractSystemInstructionText([{ text: 'a' }, { text: 'b' }])).toBe(
      'a\nb',
    );
  });

  it('extracts text from a Content object', () => {
    expect(
      extractSystemInstructionText({ role: 'user', parts: [{ text: 'sys' }] }),
    ).toBe('sys');
  });

  it('extracts text from a single Part', () => {
    expect(extractSystemInstructionText({ text: 'part' })).toBe('part');
  });

  it('returns undefined for undefined input', () => {
    expect(extractSystemInstructionText(undefined)).toBeUndefined();
  });
});

describe('sanitizeFunctionName', () => {
  it('keeps valid names unchanged', () => {
    expect(sanitizeFunctionName('my_tool-1')).toBe('my_tool-1');
  });

  it('replaces invalid characters', () => {
    expect(sanitizeFunctionName('custom/server:get')).toBe('custom_server_get');
  });

  it('truncates names longer than 64 chars', () => {
    expect(sanitizeFunctionName('a'.repeat(100)).length).toBe(64);
  });

  it('replaces all-invalid names with underscores', () => {
    expect(sanitizeFunctionName('///')).toBe('___');
  });
});

describe('FunctionNameMapper', () => {
  it('round-trips simple names', () => {
    const mapper = new FunctionNameMapper();
    expect(mapper.toApiName('get_weather')).toBe('get_weather');
    expect(mapper.toOriginalName('get_weather')).toBe('get_weather');
  });

  it('is stable across calls', () => {
    const mapper = new FunctionNameMapper();
    mapper.toApiName('a/b');
    expect(mapper.toApiName('a/b')).toBe('a_b');
    expect(mapper.toOriginalName('a_b')).toBe('a/b');
  });

  it('disambiguates collisions', () => {
    const mapper = new FunctionNameMapper();
    expect(mapper.toApiName('a/b')).toBe('a_b');
    expect(mapper.toApiName('a.b')).toBe('a_b_1');
    expect(mapper.toOriginalName('a_b')).toBe('a/b');
    expect(mapper.toOriginalName('a_b_1')).toBe('a.b');
  });

  it('passes unknown names through on reverse lookup', () => {
    const mapper = new FunctionNameMapper();
    expect(mapper.toOriginalName('unknown_tool')).toBe('unknown_tool');
  });
});

describe('geminiToolsToOpenAiTools', () => {
  it('converts function declarations', () => {
    const mapper = new FunctionNameMapper();
    const tools = geminiToolsToOpenAiTools(
      [
        {
          functionDeclarations: [
            {
              name: 'get_weather',
              description: 'Gets the weather',
              parameters: {
                type: 'OBJECT',
                properties: { city: { type: 'STRING' } },
              } as Schema,
            },
          ],
        },
      ],
      mapper,
    );
    expect(tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Gets the weather',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
      },
    ]);
  });

  it('skips empty names and non-function tools', () => {
    const mapper = new FunctionNameMapper();
    const tools = geminiToolsToOpenAiTools(
      [{ googleSearch: {} }, { functionDeclarations: [{ name: 'ok' }, {}] }],
      mapper,
    );
    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe('ok');
  });
});

describe('geminiConfigToOpenAiConfig', () => {
  const baseConfig: GenerateContentConfig = {
    temperature: 0.7,
    topP: 0.9,
    maxOutputTokens: 2048,
    stopSequences: ['\n\n', 'END'],
    presencePenalty: 0.5,
    frequencyPenalty: 0.2,
    seed: 42,
  };

  it('maps basic generation parameters', () => {
    const out = geminiConfigToOpenAiConfig(baseConfig, 'openai');
    expect(out).toEqual({
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 2048,
      stop: ['\n\n', 'END'],
      presence_penalty: 0.5,
      frequency_penalty: 0.2,
      seed: 42,
    });
  });

  it('maps json_object response format', () => {
    const out = geminiConfigToOpenAiConfig(
      { responseMimeType: 'application/json' },
      'openai',
    );
    expect(out.response_format).toEqual({ type: 'json_object' });
  });

  it('maps json_schema response format from responseSchema', () => {
    const out = geminiConfigToOpenAiConfig(
      {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { x: { type: 'NUMBER' } },
        } as Schema,
      },
      'openai',
    );
    expect(out.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'response',
        schema: { type: 'object', properties: { x: { type: 'number' } } },
      },
    });
  });

  it('maps tool config NONE to tool_choice none', () => {
    const out = geminiConfigToOpenAiConfig(
      {
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.NONE },
        },
      },
      'openai',
    );
    expect(out.tool_choice).toBe('none');
  });

  it('maps tool config ANY with a single allowed name', () => {
    const out = geminiConfigToOpenAiConfig(
      {
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: ['get_weather'],
          },
        },
      },
      'openai',
    );
    expect(out.tool_choice).toEqual({
      type: 'function',
      function: { name: 'get_weather' },
    });
  });

  it('sanitizes a single allowed name consistently with the tools array', () => {
    const nameMapper = new FunctionNameMapper();
    const originalName = 'mcp__my-server/tool';
    const tools = geminiToolsToOpenAiTools(
      [
        {
          functionDeclarations: [
            {
              name: originalName,
              description: 'An MCP tool',
              parameters: {},
            },
          ],
        },
      ],
      nameMapper,
    );
    const out = geminiConfigToOpenAiConfig(
      {
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [originalName],
          },
        },
      },
      'openai',
      nameMapper,
    );
    expect(tools[0].function.name).toBe('mcp__my-server_tool');
    expect(out.tool_choice).toEqual({
      type: 'function',
      function: { name: tools[0].function.name },
    });
  });

  it('maps tool config ANY without allowed names to required', () => {
    const out = geminiConfigToOpenAiConfig(
      {
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.ANY },
        },
      },
      'openai',
    );
    expect(out.tool_choice).toBe('required');
  });

  it('maps deepseek thinking config to thinking and reasoning_effort', () => {
    const out = geminiConfigToOpenAiConfig(
      {
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: ThinkingLevel.HIGH,
          thinkingBudget: 2048,
        },
      },
      'deepseek',
    );
    expect(out.extra_body).toEqual({ thinking: { type: 'enabled' } });
    expect(out.reasoning_effort).toBe('high');
  });

  it('maps deepseek thinking level LOW to reasoning_effort low', () => {
    const out = geminiConfigToOpenAiConfig(
      {
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
      },
      'deepseek',
    );
    expect(out.extra_body).toEqual({ thinking: { type: 'enabled' } });
    expect(out.reasoning_effort).toBe('low');
  });

  it('does not emit thinking fields for non-deepseek providers', () => {
    const out = geminiConfigToOpenAiConfig(
      { thinkingConfig: { includeThoughts: true } },
      'openai',
    );
    expect(out.extra_body).toBeUndefined();
    expect(out.reasoning_effort).toBeUndefined();
  });

  it('lifts reasoning_effort out of openaiExtraBody to the top level', () => {
    const config: GenerateContentConfig & {
      openaiExtraBody?: Record<string, unknown>;
    } = { openaiExtraBody: { reasoning_effort: 'max' } };
    const out = geminiConfigToOpenAiConfig(config, 'openai');
    expect(out.reasoning_effort).toBe('max');
    expect(out.extra_body).toBeUndefined();
  });

  it('prefers explicit openaiExtraBody reasoning_effort over thinkingLevel', () => {
    const config: GenerateContentConfig & {
      openaiExtraBody?: Record<string, unknown>;
    } = {
      openaiExtraBody: { reasoning_effort: 'max' },
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
    };
    const out = geminiConfigToOpenAiConfig(config, 'deepseek');
    expect(out.reasoning_effort).toBe('max');
    expect(out.extra_body).toEqual({ thinking: { type: 'enabled' } });
  });

  it('keeps other openaiExtraBody fields inside extra_body', () => {
    const config: GenerateContentConfig & {
      openaiExtraBody?: Record<string, unknown>;
    } = { openaiExtraBody: { temperature: 0.3 } };
    const out = geminiConfigToOpenAiConfig(config, 'openai');
    expect(out.extra_body).toEqual({ temperature: 0.3 });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it('returns empty object for undefined config', () => {
    expect(geminiConfigToOpenAiConfig(undefined, 'openai')).toEqual({});
  });
});

describe('geminiContentsToOpenAiMessages', () => {
  it('prepends the system instruction', () => {
    const messages = geminiContentsToOpenAiMessages(
      [{ role: 'user', parts: [{ text: 'hi' }] }],
      { systemInstruction: 'sys' },
    );
    expect(messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('converts text turns', () => {
    const messages = geminiContentsToOpenAiMessages([
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ text: 'a' }] },
    ]);
    expect(messages).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
  });

  it('converts a model turn with a function call', () => {
    const messages = geminiContentsToOpenAiMessages([
      {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'get_weather',
              args: { city: 'SF' },
              id: 'call_1',
            },
          },
        ],
      },
    ]);
    expect(messages[0]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"SF"}' },
        },
      ],
    });
  });

  it('converts a function response turn into a tool message', () => {
    const messages = geminiContentsToOpenAiMessages([
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
    ]);
    expect(messages[0]).toEqual({
      role: 'tool',
      content: '{"result":"sunny"}',
      tool_call_id: 'call_1',
    });
  });

  it('falls back to the most recent tool call id by name', () => {
    const messages = geminiContentsToOpenAiMessages([
      {
        role: 'model',
        parts: [
          {
            functionCall: { name: 'get_weather', args: {}, id: 'call_9' },
          },
        ],
      },
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'get_weather', response: {} } }],
      },
    ]);
    expect(messages[1].tool_call_id).toBe('call_9');
  });

  it('injects cached reasoning content for matching function calls', () => {
    const calls = [{ name: 'get_weather', args: { city: 'SF' }, id: 'c1' }];
    const fingerprint = fingerprintFunctionCalls(calls);
    const reasoningCache = new Map([[fingerprint, 'cached reasoning']]);
    const messages = geminiContentsToOpenAiMessages(
      [{ role: 'model', parts: [{ functionCall: calls[0] }] }],
      { reasoningCache },
    );
    expect(messages[0].reasoning_content).toBe('cached reasoning');
  });

  it('does not inject reasoning when the cache misses', () => {
    const messages = geminiContentsToOpenAiMessages(
      [
        {
          role: 'model',
          parts: [
            { functionCall: { name: 'get_weather', args: {}, id: 'c1' } },
          ],
        },
      ],
      { reasoningCache: new Map() },
    );
    expect(messages[0].reasoning_content).toBeUndefined();
  });

  it('converts images to image_url content parts', () => {
    const messages = geminiContentsToOpenAiMessages([
      {
        role: 'user',
        parts: [
          { text: 'look' },
          { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } },
        ],
      },
    ]);
    expect(messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,aGVsbG8=' },
        },
      ],
    });
  });

  it('maps function call names through the name mapper', () => {
    const mapper = new FunctionNameMapper();
    mapper.toApiName('custom/tool');
    const messages = geminiContentsToOpenAiMessages(
      [
        {
          role: 'model',
          parts: [
            { functionCall: { name: 'custom/tool', args: {}, id: 'c1' } },
          ],
        },
      ],
      { nameMapper: mapper },
    );
    expect(messages[0].tool_calls![0].function.name).toBe('custom_tool');
  });
});

describe('openAiFinishReasonToGemini', () => {
  it('maps common finish reasons', () => {
    expect(openAiFinishReasonToGemini('stop')).toBe(FinishReason.STOP);
    expect(openAiFinishReasonToGemini('tool_calls')).toBe(FinishReason.STOP);
    expect(openAiFinishReasonToGemini('function_call')).toBe(FinishReason.STOP);
    expect(openAiFinishReasonToGemini('length')).toBe(FinishReason.MAX_TOKENS);
    expect(openAiFinishReasonToGemini('content_filter')).toBe(
      FinishReason.SAFETY,
    );
  });

  it('returns undefined for missing finish reasons', () => {
    expect(openAiFinishReasonToGemini(undefined)).toBeUndefined();
    expect(openAiFinishReasonToGemini(null)).toBeUndefined();
  });

  it('maps unknown reasons to OTHER', () => {
    expect(openAiFinishReasonToGemini('weird')).toBe(FinishReason.OTHER);
  });
});

describe('openAiUsageToGeminiMetadata', () => {
  it('maps usage counters', () => {
    const metadata = openAiUsageToGeminiMetadata({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
    expect(metadata).toEqual({
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    });
  });

  it('computes total from parts when missing', () => {
    const metadata = openAiUsageToGeminiMetadata({
      prompt_tokens: 10,
      completion_tokens: 5,
    } as OpenAiUsage);
    expect(metadata!.totalTokenCount).toBe(15);
  });

  it('maps DeepSeek prompt_cache_hit_tokens to cachedContentTokenCount', () => {
    const metadata = openAiUsageToGeminiMetadata({
      prompt_tokens: 1000,
      completion_tokens: 50,
      total_tokens: 1050,
      prompt_cache_hit_tokens: 900,
      prompt_cache_miss_tokens: 100,
    });
    expect(metadata!.cachedContentTokenCount).toBe(900);
  });

  it('maps OpenAI prompt_tokens_details.cached_tokens to cachedContentTokenCount', () => {
    const metadata = openAiUsageToGeminiMetadata({
      prompt_tokens: 1000,
      completion_tokens: 50,
      total_tokens: 1050,
      prompt_tokens_details: { cached_tokens: 800 },
    });
    expect(metadata!.cachedContentTokenCount).toBe(800);
  });

  it('leaves cachedContentTokenCount unset when no cache fields are present', () => {
    const metadata = openAiUsageToGeminiMetadata({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    });
    expect(metadata!.cachedContentTokenCount).toBeUndefined();
  });

  it('returns undefined without usage', () => {
    expect(openAiUsageToGeminiMetadata(undefined)).toBeUndefined();
  });
});

describe('stableStringify', () => {
  it('orders object keys deterministically', () => {
    const a = stableStringify({ b: 1, a: 2 });
    const b = stableStringify({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it('handles nested structures', () => {
    expect(stableStringify({ z: [3, { y: 1, x: 2 }], a: 's' })).toBe(
      '{"a":"s","z":[3,{"x":2,"y":1}]}',
    );
  });
});

describe('fingerprintFunctionCalls', () => {
  it('is stable for equal call sets', () => {
    const a = fingerprintFunctionCalls([{ name: 'f', args: { b: 1, a: 2 } }]);
    const b = fingerprintFunctionCalls([{ name: 'f', args: { a: 2, b: 1 } }]);
    expect(a).toBe(b);
  });

  it('differs for different calls', () => {
    expect(fingerprintFunctionCalls([{ name: 'f', args: { a: 1 } }])).not.toBe(
      fingerprintFunctionCalls([{ name: 'f', args: { a: 2 } }]),
    );
  });

  it('returns empty string for no calls', () => {
    expect(fingerprintFunctionCalls([])).toBe('');
  });
});

describe('OpenAiChunkConverter', () => {
  it('accumulates text deltas into parts', () => {
    const converter = new OpenAiChunkConverter();
    const r1 = converter.toGeminiChunk({
      choices: [{ delta: { content: 'Hel' } }],
    });
    const r2 = converter.toGeminiChunk({
      choices: [{ delta: { content: 'lo' } }],
    });
    expect(r1.candidates![0].content!.parts).toEqual([{ text: 'Hel' }]);
    expect(r2.candidates![0].content!.parts).toEqual([{ text: 'lo' }]);
  });

  it('buffers reasoning_content and emits one consolidated thought part per block', () => {
    const converter = new OpenAiChunkConverter();
    // Reasoning fragments are buffered; nothing is emitted while the block is
    // still in progress.
    const r1 = converter.toGeminiChunk({
      choices: [{ delta: { reasoning_content: 'think' } }],
    });
    expect(r1.candidates).toBeUndefined();
    const r2 = converter.toGeminiChunk({
      choices: [{ delta: { reasoning_content: 'ing...' } }],
    });
    expect(r2.candidates).toBeUndefined();
    // The block ends when content starts; the whole reasoning block is emitted
    // as ONE thought part instead of one part per fragment.
    const r3 = converter.toGeminiChunk({
      choices: [{ delta: { content: 'Answer' } }],
    });
    expect(r3.candidates![0].content!.parts).toEqual([
      { text: 'thinking...', thought: true },
      { text: 'Answer' },
    ]);
    expect(converter.getReasoningContent()).toBe('thinking...');
  });

  it('flushes buffered reasoning when the stream finishes', () => {
    const converter = new OpenAiChunkConverter();
    const r1 = converter.toGeminiChunk({
      choices: [{ delta: { reasoning_content: 'deep' } }],
    });
    expect(r1.candidates).toBeUndefined();
    const r2 = converter.toGeminiChunk({
      choices: [{ delta: {}, finish_reason: 'stop' }],
    });
    expect(r2.candidates![0].content!.parts).toEqual([
      { text: 'deep', thought: true },
    ]);
    expect(r2.candidates![0].finishReason).toBe(FinishReason.STOP);
  });

  it('flushes buffered reasoning via toFinalGeminiChunk when the stream ends', () => {
    const converter = new OpenAiChunkConverter();
    converter.toGeminiChunk({
      choices: [{ delta: { reasoning_content: 'leftover' } }],
    });
    const finalChunk = converter.toFinalGeminiChunk();
    expect(finalChunk!.candidates![0].content!.parts).toEqual([
      { text: 'leftover', thought: true },
    ]);
    expect(converter.toFinalGeminiChunk()).toBeUndefined();
  });

  it('does not duplicate buffered reasoning across flush paths', () => {
    const converter = new OpenAiChunkConverter();
    converter.toGeminiChunk({
      choices: [{ delta: { reasoning_content: 'once' } }],
    });
    converter.toGeminiChunk({
      choices: [{ delta: { content: 'text' }, finish_reason: 'stop' }],
    });
    expect(converter.toFinalGeminiChunk()).toBeUndefined();
    expect(converter.getReasoningContent()).toBe('once');
  });

  it('assembles fragmented tool call deltas and emits them once on finish', () => {
    const converter = new OpenAiChunkConverter();
    const chunks: OpenAiStreamChunk[] = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'get_weather' } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"ci' } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'ty":"SF"}' } }],
            },
          },
        ],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ];

    let emitted = 0;
    for (const chunk of chunks) {
      const response = converter.toGeminiChunk(chunk);
      if (response.functionCalls?.length) {
        emitted++;
        expect(response.functionCalls).toEqual([
          { id: 'call_1', name: 'get_weather', args: { city: 'SF' } },
        ]);
      }
    }
    expect(emitted).toBe(1);
    expect(converter.getCompletedFunctionCalls()).toEqual([
      { id: 'call_1', name: 'get_weather', args: { city: 'SF' } },
    ]);
  });

  it('emits unflushed tool calls via toFinalGeminiChunk', () => {
    const converter = new OpenAiChunkConverter();
    converter.toGeminiChunk({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'c1', function: { name: 'f', arguments: '{}' } },
            ],
          },
        },
      ],
    });
    const finalChunk = converter.toFinalGeminiChunk();
    expect(finalChunk?.functionCalls).toEqual([
      { id: 'c1', name: 'f', args: {} },
    ]);
    expect(converter.toFinalGeminiChunk()).toBeUndefined();
  });

  it('maps usage and finish reason', () => {
    const converter = new OpenAiChunkConverter();
    const response = converter.toGeminiChunk({
      id: 'resp_1',
      model: 'deepseek-v4-flash',
      choices: [{ delta: { content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    });
    expect(response.responseId).toBe('resp_1');
    expect(response.modelVersion).toBe('deepseek-v4-flash');
    expect(response.candidates![0].finishReason).toBe(FinishReason.STOP);
    expect(response.usageMetadata).toEqual({
      promptTokenCount: 5,
      candidatesTokenCount: 3,
      totalTokenCount: 8,
    });
  });
});

describe('openAiChatCompletionToGeminiResponse', () => {
  it('converts a non-streaming response', () => {
    const completion: OpenAiChatCompletion = {
      id: 'resp_1',
      model: 'gpt-4o',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Hello',
            reasoning_content: 'hidden reasoning',
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'f', arguments: '{"a":1}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    };
    const response = openAiChatCompletionToGeminiResponse(completion);
    expect(response.responseId).toBe('resp_1');
    expect(response.modelVersion).toBe('gpt-4o');
    expect(response.candidates![0].content!.parts).toEqual([
      { text: 'hidden reasoning', thought: true },
      { text: 'Hello' },
      { functionCall: { id: 'call_1', name: 'f', args: { a: 1 } } },
    ]);
    expect(response.functionCalls).toEqual([
      { id: 'call_1', name: 'f', args: { a: 1 } },
    ]);
    expect(response.candidates![0].finishReason).toBe(FinishReason.STOP);
    expect(response.usageMetadata!.promptTokenCount).toBe(1);
  });

  it('handles empty responses', () => {
    const response = openAiChatCompletionToGeminiResponse({
      id: 'r',
      model: 'm',
    });
    expect(response.candidates).toBeUndefined();
    expect(response.functionCalls).toBeUndefined();
  });
});

describe('normalizeJsonSchema', () => {
  it('lowercases type and converts string numerics', () => {
    expect(
      normalizeJsonSchema({
        type: 'OBJECT',
        maxItems: '3',
        properties: { x: { type: 'NUMBER' } },
      }),
    ).toEqual({
      type: 'object',
      maxItems: 3,
      properties: { x: { type: 'number' } },
    });
  });
});
