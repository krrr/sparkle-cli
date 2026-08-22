/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Config } from '../config/config.js';
import { LoggingContentGenerator } from './loggingContentGenerator.js';
import { OpenAiCompatibleGenerator } from './openAiCompatibleGenerator.js';
import { ProviderType, getProviderTypeFromEnv } from '../config/constants.js';
import {
  createContentGenerator,
  createContentGeneratorConfig,
  getOpenAiProvider,
} from './contentGenerator.js';
import { LlmRole } from '../telemetry/llmRole.js';
import { resetVersionCache } from '../utils/version.js';
import { DEFAULT_OPENAI_MODEL } from 'src/config/models.js';

vi.mock('../telemetry/loggers.js', () => ({
  logApiRequest: vi.fn(),
  logApiResponse: vi.fn(),
  logApiError: vi.fn(),
  logUserPrompt: vi.fn(),
  logSessionStart: vi.fn(),
  logSessionEnd: vi.fn(),
  logFileUseEvent: vi.fn(),
}));

vi.mock('../telemetry/trace.js', () => ({
  runInDevTraceSpan: vi.fn((_opts: unknown, fn: (opts: unknown) => unknown) =>
    fn({ metadata: { attributes: {} } }),
  ),
}));

function createMockConfig(overrides: Record<string, unknown> = {}): Config {
  return {
    getModel: vi.fn().mockReturnValue('deepseek/deepseek-v4-flash'),
    getProxy: vi.fn().mockReturnValue(undefined),
    getUsageStatisticsEnabled: vi.fn().mockReturnValue(true),
    getClientName: vi.fn().mockReturnValue(undefined),
    getTelemetryLogPromptsEnabled: vi.fn().mockReturnValue(false),
    getTelemetryTracesEnabled: vi.fn().mockReturnValue(false),
    getSessionId: vi.fn().mockReturnValue('test-session-id'),
    setLatestApiRequest: vi.fn(),
    getContentGeneratorConfig: vi.fn().mockReturnValue({}),
    isInteractive: vi.fn().mockReturnValue(false),
    modelConfigService: {
      getResolvedConfig: vi.fn(),
      resolveModelId: (model: string) => model,
      resolveClassifierModelId: (_tier: string, model: string) => model,
      getModelDefinition: () => undefined,
      getModelChain: () => undefined,
      resolveChain: vi.fn(),
      registerRuntimeModelConfig: vi.fn(),
      registerRuntimeModelOverride: vi.fn(),
    },
    fakeResponses: undefined,
    fakeResponsesNonStrict: undefined,
    recordResponses: undefined,
    env: {},
    ...overrides,
  } as unknown as Config;
}

function startFakeOpenAiServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  lastBody: () => unknown;
}> {
  let lastBody: unknown = null;
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk.toString()));
    req.on('end', () => {
      lastBody = JSON.parse(raw || '{}');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'resp_1',
          model: 'deepseek-v4-flash',
          choices: [
            {
              message: { role: 'assistant', content: 'hello from openai' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        }),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise<void>((r) => server.close(() => r())),
        lastBody: () => lastBody,
      });
    });
  });
}

describe('getProviderTypeFromEnv', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('detects USE_OPENAI when only OPENAI_API_KEY is set', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    expect(getProviderTypeFromEnv()).toBe(ProviderType.USE_OPENAI);
  });

  it('prefers GEMINI_API_KEY over OPENAI_API_KEY', () => {
    vi.stubEnv('GEMINI_API_KEY', 'gemini-key');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    expect(getProviderTypeFromEnv()).toBe(ProviderType.USE_GEMINI);
  });

  it('does not select a provider based on GOOGLE_GEMINI_BASE_URL alone', () => {
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', 'https://gateway.example.com');
    expect(getProviderTypeFromEnv()).toBeUndefined();
  });
});

describe('createContentGeneratorConfig with USE_OPENAI', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('OPENAI_BASE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('picks up OPENAI_API_KEY and OPENAI_BASE_URL from the environment', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-env');
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.deepseek.com');
    const config = await createContentGeneratorConfig(
      createMockConfig(),
      ProviderType.USE_OPENAI,
    );
    expect(config).toMatchObject({
      authType: ProviderType.USE_OPENAI,
      apiKey: 'sk-env',
      baseUrl: 'https://api.deepseek.com',
    });
  });

  it('defaults the base URL to the OpenAI endpoint', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-env');
    const config = await createContentGeneratorConfig(
      createMockConfig(),
      ProviderType.USE_OPENAI,
    );
    expect(config.baseUrl).toBe('https://api.openai.com/v1');
  });
});

describe('getOpenAiProvider', () => {
  it('detects deepseek from the model prefix', () => {
    expect(
      getOpenAiProvider(
        createMockConfig(),
        { authType: ProviderType.USE_OPENAI },
        'deepseek/deepseek-v4-flash',
      ),
    ).toBe('deepseek');
  });

  it('detects deepseek from the model name without a prefix', () => {
    expect(
      getOpenAiProvider(
        createMockConfig(),
        {
          authType: ProviderType.USE_OPENAI,
          baseUrl: 'https://api.openai.com/v1',
        },
        'deepseek-v4-flash',
      ),
    ).toBe('deepseek');
    expect(
      getOpenAiProvider(
        createMockConfig(),
        { authType: ProviderType.USE_OPENAI },
        'deepseek-v4-flash',
      ),
    ).toBe('deepseek');
    expect(
      getOpenAiProvider(
        createMockConfig(),
        { authType: ProviderType.USE_OPENAI },
        'deepseek-v4-pro',
      ),
    ).toBe('deepseek');
  });

  it('detects deepseek from the model name case-insensitively', () => {
    expect(
      getOpenAiProvider(
        createMockConfig(),
        { authType: ProviderType.USE_OPENAI },
        'DeepSeek-Chinese-V3',
      ),
    ).toBe('deepseek');
  });

  it('detects deepseek from the base URL hostname', () => {
    expect(
      getOpenAiProvider(
        createMockConfig(),
        {
          authType: ProviderType.USE_OPENAI,
          baseUrl: 'https://api.deepseek.com',
        },
        'some-model',
      ),
    ).toBe('deepseek');
  });

  it('defaults to openai', () => {
    expect(
      getOpenAiProvider(
        createMockConfig(),
        {
          authType: ProviderType.USE_OPENAI,
          baseUrl: 'https://api.openai.com/v1',
        },
        DEFAULT_OPENAI_MODEL,
      ),
    ).toBe('openai');
    expect(
      getOpenAiProvider(
        createMockConfig(),
        { authType: ProviderType.USE_OPENAI },
        'claude-sonnet-4',
      ),
    ).toBe('openai');
  });

  it('honors the OPENAI_PROVIDER env var', () => {
    vi.stubEnv('OPENAI_PROVIDER', 'custom');
    expect(
      getOpenAiProvider(
        createMockConfig(),
        {
          authType: ProviderType.USE_OPENAI,
          baseUrl: 'https://api.openai.com/v1',
        },
        DEFAULT_OPENAI_MODEL,
      ),
    ).toBe('custom');
    vi.unstubAllEnvs();
  });

  it('prefers OPENAI_PROVIDER over the model name pattern', () => {
    vi.stubEnv('OPENAI_PROVIDER', 'custom');
    expect(
      getOpenAiProvider(
        createMockConfig(),
        { authType: ProviderType.USE_OPENAI },
        'deepseek-v4-flash',
      ),
    ).toBe('custom');
    vi.unstubAllEnvs();
  });
});

describe('createContentGenerator with USE_OPENAI', () => {
  beforeEach(() => {
    resetVersionCache();
    vi.clearAllMocks();
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('OPENAI_BASE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('wraps an OpenAiCompatibleGenerator in a LoggingContentGenerator', async () => {
    const config = createMockConfig();
    const generator = await createContentGenerator(
      {
        authType: ProviderType.USE_OPENAI,
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      },
      config,
    );
    expect(generator).toBeInstanceOf(LoggingContentGenerator);
    const wrapped = (generator as LoggingContentGenerator).getWrapped();
    expect(wrapped).toBeInstanceOf(OpenAiCompatibleGenerator);
  });

  it('performs a full roundtrip through the wiring', async () => {
    const fake = await startFakeOpenAiServer();
    try {
      const config = createMockConfig();
      const generator = await createContentGenerator(
        {
          authType: ProviderType.USE_OPENAI,
          apiKey: 'sk-test',
          baseUrl: fake.baseUrl,
        },
        config,
      );
      const response = await generator.generateContent(
        {
          model: 'deepseek/deepseek-v4-flash',
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
        },
        'prompt-1',
        LlmRole.MAIN,
      );
      expect(response.candidates![0].content!.parts![0].text).toBe(
        'hello from openai',
      );
      const body = fake.lastBody() as { model: string; messages: unknown[] };
      expect(body.model).toBe('deepseek-v4-flash');
      expect(body.messages).toHaveLength(1);
    } finally {
      await fake.close();
    }
  });
});
