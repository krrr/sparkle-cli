/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderType, getProviderTypeFromEnv } from '../config/constants.js';
import {
  createContentGenerator,
  createContentGeneratorConfig,
  type ContentGenerator,
} from './contentGenerator.js';
import { DEFAULT_OPENAI_BASE_URL } from './openAiCompatibleGenerator.js';
import { GoogleGenAI } from '@google/genai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Config } from '../config/config.js';
import { LoggingContentGenerator } from './loggingContentGenerator.js';
import { GoogleGenAiContentGenerator } from './googleGenAiContentGenerator.js';
import { FakeContentGenerator } from './fakeContentGenerator.js';
import { RecordingContentGenerator } from './recordingContentGenerator.js';
import { resetVersionCache } from '../utils/version.js';
import type { LlmRole } from '../telemetry/llmRole.js';
import type { ModelConfigService } from '../services/modelConfigService.js';

vi.mock('@google/genai');

vi.mock('./fakeContentGenerator.js');

const modelConfigService = {
  getResolvedConfig: vi.fn(),
  resolveModelId: (model: string) => model,
  resolveClassifierModelId: (_tier: string, model: string) => model,
  getModelDefinition: () => undefined,
  getModelChain: () => undefined,
  resolveChain: vi.fn(),
  registerRuntimeModelConfig: vi.fn(),
  registerRuntimeModelOverride: vi.fn(),
} as unknown as ModelConfigService;

const mockConfig = {
  getModel: vi.fn().mockReturnValue('gemini-pro'),
  modelConfigService,
  getProxy: vi.fn().mockReturnValue(undefined),
  getUsageStatisticsEnabled: vi.fn().mockReturnValue(true),
  getClientName: vi.fn().mockReturnValue(undefined),
  getTelemetryLogPromptsEnabled: vi.fn().mockReturnValue(true),
  getTelemetryTracesEnabled: vi.fn().mockReturnValue(true),
  getSessionId: vi.fn().mockReturnValue('test-session-id'),
  refreshUserQuotaIfStale: vi.fn().mockResolvedValue(undefined),
  setLatestApiRequest: vi.fn(),
  getContentGeneratorConfig: vi.fn().mockReturnValue({}),
  isInteractive: vi.fn().mockReturnValue(false),
  getExperiments: vi.fn().mockReturnValue(undefined),
} as unknown as Config;

function createMockConfig(overrides: Partial<Config> = {}): Config {
  return {
    getModel: vi.fn().mockReturnValue('gemini-pro'),
    modelConfigService,
    getProxy: vi.fn().mockReturnValue(undefined),
    getUsageStatisticsEnabled: () => true,
    getClientName: vi.fn().mockReturnValue(undefined),
    ...overrides,
  } as unknown as Config;
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

  it('should not select a provider when only GOOGLE_GEMINI_BASE_URL is set', () => {
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', 'https://gateway.example.com');
    expect(getProviderTypeFromEnv()).toBeUndefined();
  });

  it('should detect USE_GEMINI when GEMINI_API_KEY is present', () => {
    vi.stubEnv('GEMINI_API_KEY', 'fake-key');
    expect(getProviderTypeFromEnv()).toBe(ProviderType.USE_GEMINI);
  });

  it('should return undefined when no matching env variables are set', () => {
    expect(getProviderTypeFromEnv()).toBeUndefined();
  });
});

describe('createContentGenerator', () => {
  beforeEach(() => {
    resetVersionCache();
    vi.clearAllMocks();
    vi.stubEnv('ANTIGRAVITY_CLI_ALIAS', '');
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a FakeContentGenerator', async () => {
    const mockGenerator = {} as unknown as ContentGenerator;
    vi.mocked(FakeContentGenerator.fromFile).mockResolvedValue(
      mockGenerator as never,
    );
    const fakeResponsesFile = 'fake/responses.yaml';
    const mockConfigWithFake = {
      fakeResponses: fakeResponsesFile,
      getClientName: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;
    const generator = await createContentGenerator(
      {
        authType: ProviderType.USE_GEMINI,
      },
      mockConfigWithFake,
    );
    expect(FakeContentGenerator.fromFile).toHaveBeenCalledWith(
      fakeResponsesFile,
    );
    expect(generator).toEqual(
      new LoggingContentGenerator(mockGenerator, mockConfigWithFake),
    );
  });

  it('should create a RecordingContentGenerator', async () => {
    const fakeResponsesFile = 'fake/responses.yaml';
    const recordResponsesFile = 'record/responses.yaml';
    const mockConfigWithRecordResponses = {
      fakeResponses: fakeResponsesFile,
      recordResponses: recordResponsesFile,
      getClientName: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;
    const generator = await createContentGenerator(
      {
        authType: ProviderType.USE_GEMINI,
      },
      mockConfigWithRecordResponses,
    );
    expect(generator).toBeInstanceOf(RecordingContentGenerator);
  });

  it('should create a GoogleGenAI content generator', async () => {
    const mockConfig = createMockConfig();

    // Set a fixed version for testing
    vi.stubEnv('CLI_VERSION', '1.2.3');
    vi.stubEnv('TERM_PROGRAM', 'iTerm.app');
    vi.stubEnv('VSCODE_PID', '');
    vi.stubEnv('GITHUB_SHA', '');
    vi.stubEnv('SPARKLE_CLI_SURFACE', '');

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    const generator = await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
      },
      mockConfig,
    );
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringMatching(
            /SparkleCLI\/1\.2\.3\/gemini-pro \(.*; .*; terminal\)/,
          ),
        }),
      }),
    });
    expect(generator).toEqual(
      new LoggingContentGenerator(
        new GoogleGenAiContentGenerator(mockGenerator.models),
        mockConfig,
      ),
    );
  });

  it('should use standard User-Agent for a2a-server running outside VS Code', async () => {
    const mockConfig = createMockConfig({
      getClientName: vi.fn().mockReturnValue('a2a-server'),
    });

    // Set a fixed version for testing
    vi.stubEnv('CLI_VERSION', '1.2.3');
    vi.stubEnv('TERM_PROGRAM', 'iTerm.app');
    vi.stubEnv('VSCODE_PID', '');
    vi.stubEnv('GITHUB_SHA', '');
    vi.stubEnv('SPARKLE_CLI_SURFACE', '');

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    await createContentGenerator(
      { apiKey: 'test-api-key', authType: ProviderType.USE_GEMINI },
      mockConfig,
      undefined,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOptions: expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringMatching(
              /SparkleCLI-a2a-server\/1\.2\.3\/gemini-pro \(.*; .*; terminal\)/,
            ),
          }),
        }),
      }),
    );
  });

  it('should include unified User-Agent for a2a-server (VS Code Agent Mode)', async () => {
    const mockConfig = createMockConfig({
      getClientName: vi.fn().mockReturnValue('a2a-server'),
    });

    // Set a fixed version for testing
    vi.stubEnv('CLI_VERSION', '1.2.3');
    // Mock the environment variable that the VS Code extension host would provide to the a2a-server process
    vi.stubEnv('VSCODE_PID', '12345');
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('TERM_PROGRAM_VERSION', '1.85.0');

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    await createContentGenerator(
      { apiKey: 'test-api-key', authType: ProviderType.USE_GEMINI },
      mockConfig,
      undefined,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOptions: expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringMatching(
              /CloudCodeVSCode\/1\.2\.3 \(aidev_client; os_type=.*; os_version=.*; arch=.*; host_path=VSCode\/1\.85\.0; proxy_client=geminicli\)/,
            ),
          }),
        }),
      }),
    );
  });

  it('should include clientName prefix in User-Agent when specified (non-VSCode)', async () => {
    const mockConfig = createMockConfig({
      getClientName: vi.fn().mockReturnValue('my-client'),
    });

    // Set a fixed version for testing
    vi.stubEnv('CLI_VERSION', '1.2.3');
    vi.stubEnv('TERM_PROGRAM', 'iTerm.app');
    vi.stubEnv('VSCODE_PID', '');
    vi.stubEnv('GITHUB_SHA', '');
    vi.stubEnv('SPARKLE_CLI_SURFACE', '');

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    await createContentGenerator(
      { apiKey: 'test-api-key', authType: ProviderType.USE_GEMINI },
      mockConfig,
      undefined,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOptions: expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringMatching(
              /SparkleCLI-my-client\/1\.2\.3\/gemini-pro \(.*; .*; terminal\)/,
            ),
          }),
        }),
      }),
    );
  });

  it('should allow custom headers to override User-Agent', async () => {
    const mockConfig = createMockConfig();

    vi.stubEnv('SPARKLE_CLI_CUSTOM_HEADERS', 'User-Agent:MyCustomUA');

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    await createContentGenerator(
      { apiKey: 'test-api-key', authType: ProviderType.USE_GEMINI },
      mockConfig,
      undefined,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOptions: expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'MyCustomUA',
          }),
        }),
      }),
    );
  });

  it('should include custom headers from SPARKLE_CLI_CUSTOM_HEADERS for GoogleGenAI requests without inferring auth mechanism', async () => {
    const mockConfig = createMockConfig({
      getUsageStatisticsEnabled: () => false,
    });

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    vi.stubEnv(
      'SPARKLE_CLI_CUSTOM_HEADERS',
      'X-Test-Header: test, Another: value',
    );

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
          'X-Test-Header': 'test',
          Another: 'value',
        }),
      }),
    });
    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.not.objectContaining({
        httpOptions: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.any(String),
          }),
        }),
      }),
    );
  });

  it('should inject HttpsProxyAgent into googleAuthOptions when proxy URL uses https://', async () => {
    const mockConfigWithProxy = createMockConfig({
      getProxy: vi.fn().mockReturnValue('https://proxy.example.com:8080'),
      getUsageStatisticsEnabled: () => false,
    });

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator);

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
        proxy: 'https://proxy.example.com:8080',
      },
      mockConfigWithProxy,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        googleAuthOptions: expect.objectContaining({
          clientOptions: expect.objectContaining({
            transporterOptions: expect.objectContaining({
              agent: expect.any(HttpsProxyAgent),
            }),
          }),
        }),
      }),
    );
  });

  it('should still use HttpsProxyAgent for HTTPS destinations even when proxy URL uses http://', async () => {
    const mockConfigWithProxy = createMockConfig({
      getProxy: vi.fn().mockReturnValue('http://proxy.example.com:8080'),
      getUsageStatisticsEnabled: () => false,
    });

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator);

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
        proxy: 'http://proxy.example.com:8080',
      },
      mockConfigWithProxy,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        googleAuthOptions: expect.objectContaining({
          clientOptions: expect.objectContaining({
            transporterOptions: expect.objectContaining({
              agent: expect.any(HttpsProxyAgent),
            }),
          }),
        }),
      }),
    );
  });

  it('should trim whitespace from proxy URL before instantiating agent', async () => {
    const mockConfigWithProxy = createMockConfig({
      getProxy: vi.fn().mockReturnValue('  https://proxy.example.com:8080  '),
      getUsageStatisticsEnabled: () => false,
    });

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator);

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
        proxy: '  https://proxy.example.com:8080  ',
      },
      mockConfigWithProxy,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        googleAuthOptions: expect.objectContaining({
          clientOptions: expect.objectContaining({
            transporterOptions: expect.objectContaining({
              agent: expect.any(HttpsProxyAgent),
            }),
          }),
        }),
      }),
    );
  });

  it('should not include googleAuthOptions when no proxy is configured', async () => {
    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator);

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
      },
      mockConfig,
    );

    const callArg = vi.mocked(GoogleGenAI).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(callArg).not.toHaveProperty('googleAuthOptions');
  });

  it('should pass api key as Authorization Header when GEMINI_API_KEY_AUTH_MECHANISM is set to bearer', async () => {
    const mockConfig = createMockConfig({
      getUsageStatisticsEnabled: () => false,
    });

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    vi.stubEnv('GEMINI_API_KEY_AUTH_MECHANISM', 'bearer');

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
          Authorization: 'Bearer test-api-key',
        }),
      }),
    });
  });

  it('should not pass api key as Authorization Header when GEMINI_API_KEY_AUTH_MECHANISM is not set (default behavior)', async () => {
    const mockConfig = createMockConfig({
      getUsageStatisticsEnabled: () => false,
    });

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    // GEMINI_API_KEY_AUTH_MECHANISM is not stubbed, so it will be undefined, triggering default 'x-goog-api-key'

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
        }),
      }),
    });
    // Explicitly assert that Authorization header is NOT present
    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.not.objectContaining({
        httpOptions: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.any(String),
          }),
        }),
      }),
    );
  });

  it('should create a GoogleGenAI content generator with client install id logging disabled', async () => {
    const mockConfig = createMockConfig({
      getUsageStatisticsEnabled: () => false,
    });
    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    const generator = await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
      },
      mockConfig,
    );
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      httpOptions: expect.objectContaining({
        headers: {
          'User-Agent': expect.any(String),
        },
      }),
    });
    expect(generator).toEqual(
      new LoggingContentGenerator(
        new GoogleGenAiContentGenerator(mockGenerator.models),
        mockConfig,
      ),
    );
  });

  it('should pass apiVersion to GoogleGenAI when GOOGLE_GENAI_API_VERSION is set', async () => {
    const mockConfig = createMockConfig({
      getUsageStatisticsEnabled: () => false,
    });

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    vi.stubEnv('GOOGLE_GENAI_API_VERSION', 'v1');

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
        }),
      }),
      apiVersion: 'v1',
    });
  });

  it('should not include apiVersion when GOOGLE_GENAI_API_VERSION is not set', async () => {
    const mockConfig = createMockConfig({
      getUsageStatisticsEnabled: () => false,
    });

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
        }),
      }),
    });

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.not.objectContaining({
        apiVersion: expect.any(String),
      }),
    );
  });

  it('should not include apiVersion when GOOGLE_GENAI_API_VERSION is an empty string', async () => {
    const mockConfig = createMockConfig({
      getUsageStatisticsEnabled: () => false,
    });

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    vi.stubEnv('GOOGLE_GENAI_API_VERSION', '');

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
        }),
      }),
    });

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.not.objectContaining({
        apiVersion: expect.any(String),
      }),
    );
  });

  it('should pass baseUrl to GoogleGenAI when GOOGLE_GEMINI_BASE_URL is set', async () => {
    const mockConfig = createMockConfig({
      getUsageStatisticsEnabled: () => false,
    });

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', 'https://gemini.test.local');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');

    const config = await createContentGeneratorConfig(
      mockConfig,
      ProviderType.USE_GEMINI,
    );
    await createContentGenerator(config, mockConfig);

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'test-api-key',
        httpOptions: expect.objectContaining({
          baseUrl: 'https://gemini.test.local',
        }),
      }),
    );
  });

  it('should prefer an explicit baseUrl over GOOGLE_GEMINI_BASE_URL', async () => {
    const mockConfig = createMockConfig({
      getUsageStatisticsEnabled: () => false,
    });

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', 'https://env.test.local');
    vi.stubEnv('GEMINI_API_KEY', 'test-api-key');

    const config = await createContentGeneratorConfig(
      mockConfig,
      ProviderType.USE_GEMINI,
      undefined,
      'https://explicit.test.local',
    );
    await createContentGenerator(config, mockConfig);

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOptions: expect.objectContaining({
          baseUrl: 'https://explicit.test.local',
        }),
      }),
    );
  });

  it('should allow localhost baseUrl overrides over http', async () => {
    const mockConfig = createMockConfig({
      getUsageStatisticsEnabled: () => false,
    });

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
        baseUrl: 'http://127.0.0.1:8080',
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOptions: expect.objectContaining({
          baseUrl: 'http://127.0.0.1:8080',
        }),
      }),
    );
  });

  it('should reject invalid custom baseUrl values', async () => {
    await expect(
      createContentGenerator(
        {
          apiKey: 'test-api-key',
          authType: ProviderType.USE_GEMINI,
          baseUrl: 'not-a-url',
        },
        mockConfig,
      ),
    ).rejects.toThrow('Invalid custom base URL: not-a-url');
  });

  it('should set empty x-goog-api-key header for custom endpoint without apiKey', async () => {
    const mockConfig = createMockConfig({
      getUsageStatisticsEnabled: () => false,
    });

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);

    await createContentGenerator(
      {
        authType: ProviderType.USE_GEMINI,
        baseUrl: 'https://gateway.test.local',
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: '',
        httpOptions: expect.objectContaining({
          headers: expect.objectContaining({
            'x-goog-api-key': '',
          }),
        }),
      }),
    );
  });

  it('should not apply model mapping for Gemini API', async () => {
    const mockModels = {
      generateContent: vi.fn().mockResolvedValue({}),
    };
    const mockGenerator = {
      models: mockModels,
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);

    const generator = await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: ProviderType.USE_GEMINI,
      },
      mockConfig,
    );

    await generator.generateContent(
      {
        model: 'gemini-3-flash',
        contents: [],
      },
      'prompt-id',
      'user' as LlmRole,
    );

    expect(mockModels.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-flash',
      }),
    );
  });
});

describe('createContentGeneratorConfig', () => {
  const mockConfig = {
    getModel: vi.fn().mockReturnValue('gemini-pro'),
    setModel: vi.fn(),
    flashFallbackHandler: vi.fn(),
    getProxy: vi.fn(),
    getClientName: vi.fn().mockReturnValue(undefined),
  } as unknown as Config;

  beforeEach(() => {
    // Reset modules to re-evaluate imports and environment variables
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should configure for Gemini using GEMINI_API_KEY when set', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'env-gemini-key');
    const config = await createContentGeneratorConfig(
      mockConfig,
      ProviderType.USE_GEMINI,
    );
    expect(config.apiKey).toBe('env-gemini-key');
  });

  it('should not configure for Gemini if GEMINI_API_KEY is empty', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const config = await createContentGeneratorConfig(
      mockConfig,
      ProviderType.USE_GEMINI,
    );
    expect(config.apiKey).toBeUndefined();
  });

  it('should configure for Gemini using the provided apiKey if available', async () => {
    const config = await createContentGeneratorConfig(
      mockConfig,
      ProviderType.USE_GEMINI,
      'custom-gemini-key',
    );
    expect(config.apiKey).toBe('custom-gemini-key');
  });

  it('should not configure a key for Gemini when no apiKey is provided and env is not set', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const config = await createContentGeneratorConfig(
      mockConfig,
      ProviderType.USE_GEMINI,
    );
    expect(config.apiKey).toBeUndefined();
  });

  it('should configure for USE_OPENAI using OPENAI_API_KEY when set', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'env-openai-key');
    vi.stubEnv('OPENAI_BASE_URL', '');
    const config = await createContentGeneratorConfig(
      mockConfig,
      ProviderType.USE_OPENAI,
    );
    expect(config.apiKey).toBe('env-openai-key');
    expect(config.baseUrl).toBe(DEFAULT_OPENAI_BASE_URL);
  });

  it('should configure for USE_OPENAI with an empty apiKey when no key is available', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('OPENAI_BASE_URL', '');
    const config = await createContentGeneratorConfig(
      mockConfig,
      ProviderType.USE_OPENAI,
    );
    expect(config.apiKey).toBe('');
  });

  it('should prefer the explicit apiKey over env for USE_OPENAI', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'env-openai-key');
    vi.stubEnv('OPENAI_BASE_URL', '');
    const config = await createContentGeneratorConfig(
      mockConfig,
      ProviderType.USE_OPENAI,
      'explicit-openai-key',
    );
    expect(config.apiKey).toBe('explicit-openai-key');
  });

  it('should use the configured base URL for USE_OPENAI', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('OPENAI_BASE_URL', 'https://custom.example.com/v1');
    const config = await createContentGeneratorConfig(
      mockConfig,
      ProviderType.USE_OPENAI,
    );
    expect(config.baseUrl).toBe('https://custom.example.com/v1');
  });
});
