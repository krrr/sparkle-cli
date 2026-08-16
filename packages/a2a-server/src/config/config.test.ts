/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { loadConfig } from './config.js';
import type { Settings } from './settings.js';
import {
  type ExtensionLoader,
  Config,
  ProviderType,
  isHeadlessMode,
  PolicyDecision,
  ApprovalMode,
  PRIORITY_YOLO_ALLOW_ALL,
  createPolicyEngineConfig,
} from 'sparkle-cli-core';
import type { AgentSettings } from '../types.js';

// Isolate environment loading from the user's real ~/.sparkle/.env file.
const mockHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-home-'));

// Mock dependencies
vi.mock('sparkle-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sparkle-cli-core')>();
  return {
    ...actual,
    homedir: () => mockHomeDir,
    PRIORITY_YOLO_ALLOW_ALL: 998,
    Config: vi.fn().mockImplementation((params) => {
      const mockConfig = {
        ...params,
        initialize: vi.fn(),
        waitForMcpInit: vi.fn(),
        refreshAuth: vi.fn(),
        getExperiments: vi.fn().mockReturnValue({
          flags: {},
        }),
      };
      return mockConfig;
    }),
    startupProfiler: {
      flush: vi.fn(),
    },
    isHeadlessMode: vi.fn().mockReturnValue(false),
    createPolicyEngineConfig: vi
      .fn()
      .mockImplementation(
        (_settings, mode, _defaultPoliciesDir, _interactive) => ({
          rules:
            mode === actual.ApprovalMode.YOLO
              ? [
                  {
                    toolName: '*',
                    decision: actual.PolicyDecision.ALLOW,
                    priority: actual.PRIORITY_YOLO_ALLOW_ALL,
                    modes: [actual.ApprovalMode.YOLO],
                    allowRedirection: true,
                  },
                ]
              : [
                  {
                    toolName: 'read_file',
                    decision: actual.PolicyDecision.ALLOW,
                    priority: 1.05,
                    source: 'Default: read-only.toml',
                  },
                ],
          checkers: [],
        }),
      ),
  };
});

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('loadConfig', () => {
  const mockSettings = {} as Settings;
  const mockExtensionLoader = {} as ExtensionLoader;
  const taskId = 'test-task-id';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('admin settings overrides', () => {
    it('should pass clientName as a2a-server to Config', async () => {
      await loadConfig(mockSettings, mockExtensionLoader, taskId);
      expect(Config).toHaveBeenCalledWith(
        expect.objectContaining({
          clientName: 'a2a-server',
        }),
      );
    });
  });

  it('should set customIgnoreFilePaths when CUSTOM_IGNORE_FILE_PATHS env var is present', async () => {
    const testPath = '/tmp/ignore';
    vi.stubEnv('CUSTOM_IGNORE_FILE_PATHS', testPath);
    const config = await loadConfig(mockSettings, mockExtensionLoader, taskId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((config as any).fileFiltering.customIgnoreFilePaths).toEqual([
      testPath,
    ]);
  });

  it('should set customIgnoreFilePaths when settings.fileFiltering.customIgnoreFilePaths is present', async () => {
    const testPath = '/settings/ignore';
    const settings: Settings = {
      fileFiltering: {
        customIgnoreFilePaths: [testPath],
      },
    };
    const config = await loadConfig(settings, mockExtensionLoader, taskId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((config as any).fileFiltering.customIgnoreFilePaths).toEqual([
      testPath,
    ]);
  });

  it('should merge customIgnoreFilePaths from settings and env var', async () => {
    const envPath = '/env/ignore';
    const settingsPath = '/settings/ignore';
    vi.stubEnv('CUSTOM_IGNORE_FILE_PATHS', envPath);
    const settings: Settings = {
      fileFiltering: {
        customIgnoreFilePaths: [settingsPath],
      },
    };
    const config = await loadConfig(settings, mockExtensionLoader, taskId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((config as any).fileFiltering.customIgnoreFilePaths).toEqual([
      settingsPath,
      envPath,
    ]);
  });

  it('should split CUSTOM_IGNORE_FILE_PATHS using system delimiter', async () => {
    const paths = ['/path/one', '/path/two'];
    vi.stubEnv('CUSTOM_IGNORE_FILE_PATHS', paths.join(path.delimiter));
    const config = await loadConfig(mockSettings, mockExtensionLoader, taskId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((config as any).fileFiltering.customIgnoreFilePaths).toEqual(paths);
  });

  it('should have empty customIgnoreFilePaths when both are missing', async () => {
    const config = await loadConfig(mockSettings, mockExtensionLoader, taskId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((config as any).fileFiltering.customIgnoreFilePaths).toEqual([]);
  });

  describe('policy engine configuration', () => {
    it('should map tool settings into policySettings', async () => {
      const settings: Settings = {
        tools: {
          allowed: ['v2-allowed'],
          exclude: ['v2-exclude'],
          core: ['v2-core'],
        },
        mcpServers: {
          test: { command: 'test', args: [] },
        },
        policyPaths: ['/path/to/policy'],
      };

      await loadConfig(settings, mockExtensionLoader, taskId);

      expect(createPolicyEngineConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: {
            core: ['v2-core'],
            exclude: ['v2-exclude'],
            allowed: ['v2-allowed'],
          },
          mcpServers: settings.mcpServers,
          policyPaths: settings.policyPaths,
        }),
        ApprovalMode.DEFAULT,
        undefined,
        true,
      );
    });
  });

  describe('tool configuration', () => {
    it('should pass V2 tools.allowed to Config properly', async () => {
      const settings: Settings = {
        tools: {
          allowed: ['shell', 'fetch'],
        },
      };
      await loadConfig(settings, mockExtensionLoader, taskId);
      expect(Config).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedTools: ['shell', 'fetch'],
        }),
      );
    });

    it('should pass enableAgents to Config constructor', async () => {
      const settings: Settings = {
        experimental: {
          enableAgents: false,
        },
      };
      await loadConfig(settings, mockExtensionLoader, taskId);
      expect(Config).toHaveBeenCalledWith(
        expect.objectContaining({
          enableAgents: false,
        }),
      );
    });

    it('should default enableAgents to true when not provided', async () => {
      await loadConfig(mockSettings, mockExtensionLoader, taskId);
      expect(Config).toHaveBeenCalledWith(
        expect.objectContaining({
          enableAgents: true,
        }),
      );
    });

    describe('interactivity', () => {
      it('should always set interactive true', async () => {
        vi.mocked(isHeadlessMode).mockReturnValue(true);
        await loadConfig(mockSettings, mockExtensionLoader, taskId);
        expect(Config).toHaveBeenCalledWith(
          expect.objectContaining({
            interactive: true,
          }),
        );

        vi.mocked(isHeadlessMode).mockReturnValue(false);
        await loadConfig(mockSettings, mockExtensionLoader, taskId);
        expect(Config).toHaveBeenCalledWith(
          expect.objectContaining({
            interactive: true,
          }),
        );
      });

      it('should set enableInteractiveShell based on headless mode', async () => {
        vi.mocked(isHeadlessMode).mockReturnValue(false);
        await loadConfig(mockSettings, mockExtensionLoader, taskId);
        expect(Config).toHaveBeenCalledWith(
          expect.objectContaining({
            enableInteractiveShell: true,
          }),
        );

        vi.mocked(isHeadlessMode).mockReturnValue(true);
        await loadConfig(mockSettings, mockExtensionLoader, taskId);
        expect(Config).toHaveBeenCalledWith(
          expect.objectContaining({
            enableInteractiveShell: false,
          }),
        );
      });
    });

    describe('YOLO mode', () => {
      it('should enable YOLO mode and add policy rule when SPARKLE_YOLO_MODE is true', async () => {
        vi.stubEnv('SPARKLE_YOLO_MODE', 'true');
        await loadConfig(mockSettings, mockExtensionLoader, taskId);
        expect(Config).toHaveBeenCalledWith(
          expect.objectContaining({
            approvalMode: 'yolo',
            policyEngineConfig: expect.objectContaining({
              rules: expect.arrayContaining([
                expect.objectContaining({
                  decision: PolicyDecision.ALLOW,
                  priority: PRIORITY_YOLO_ALLOW_ALL,
                  modes: ['yolo'],
                  allowRedirection: true,
                }),
              ]),
            }),
          }),
        );
      });

      it('should use default approval mode and load default rules when SPARKLE_YOLO_MODE is not true', async () => {
        vi.stubEnv('SPARKLE_YOLO_MODE', 'false');
        await loadConfig(mockSettings, mockExtensionLoader, taskId);
        expect(Config).toHaveBeenCalledWith(
          expect.objectContaining({
            approvalMode: 'default',
            policyEngineConfig: expect.objectContaining({
              rules: expect.arrayContaining([
                expect.objectContaining({
                  toolName: 'read_file',
                  decision: PolicyDecision.ALLOW,
                }),
              ]),
            }),
          }),
        );
      });
    });

    describe('authentication logic', () => {
      const setupConfigMock = (refreshAuthMock: ReturnType<typeof vi.fn>) => {
        vi.mocked(Config).mockImplementation(
          (params: unknown) =>
            ({
              ...(params as object),
              initialize: vi.fn(),
              waitForMcpInit: vi.fn(),
              refreshAuth: refreshAuthMock,
              getExperiments: vi.fn().mockReturnValue({ flags: {} }),
            }) as unknown as Config,
        );
      };

      beforeEach(() => {
        vi.stubEnv('GEMINI_API_KEY', '');
      });

      afterEach(() => {
        vi.unstubAllEnvs();
      });

      it('should use Gemini API key when GEMINI_API_KEY is set', async () => {
        vi.stubEnv('GEMINI_API_KEY', 'test-key');
        const refreshAuthMock = vi.fn().mockResolvedValue(undefined);
        setupConfigMock(refreshAuthMock);

        await loadConfig(mockSettings, mockExtensionLoader, taskId);

        expect(refreshAuthMock).toHaveBeenCalledWith(
          ProviderType.USE_GEMINI,
          'test-key',
        );
      });

      it('should throw an error when no auth method is available', async () => {
        const refreshAuthMock = vi.fn().mockResolvedValue(undefined);
        setupConfigMock(refreshAuthMock);

        await expect(
          loadConfig(mockSettings, mockExtensionLoader, taskId),
        ).rejects.toThrow(
          'Unable to set GeneratorConfig. Please provide a GEMINI_API_KEY.',
        );
      });
    });
  });
});

describe('setIsTrusted', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return true when SPARKLE_FOLDER_TRUST env var is true', async () => {
    vi.stubEnv('SPARKLE_FOLDER_TRUST', 'true');
    const { setIsTrusted } = await import('./config.js');
    expect(setIsTrusted(undefined)).toBe(true);
    expect(setIsTrusted({ isTrusted: false } as AgentSettings)).toBe(true);
  });

  it('should return false when SPARKLE_FOLDER_TRUST env var is false', async () => {
    vi.stubEnv('SPARKLE_FOLDER_TRUST', 'false');
    const { setIsTrusted } = await import('./config.js');
    expect(setIsTrusted(undefined)).toBe(false);
    expect(setIsTrusted({ isTrusted: true } as AgentSettings)).toBe(false);
  });

  it('should fallback to agentSettings.isTrusted if env var is undefined', async () => {
    const { setIsTrusted } = await import('./config.js');
    expect(setIsTrusted({ isTrusted: true } as AgentSettings)).toBe(true);
    expect(setIsTrusted({ isTrusted: false } as AgentSettings)).toBe(false);
    expect(setIsTrusted(undefined)).toBe(false);
  });
});
