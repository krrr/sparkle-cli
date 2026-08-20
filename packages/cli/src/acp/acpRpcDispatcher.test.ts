/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type Mock,
  type Mocked,
} from 'vitest';
import { GeminiAgent } from './acpRpcDispatcher.js';
import * as acp from '@agentclientprotocol/sdk';
import {
  ProviderType,
  type Config,
  type MessageBus,
  type Storage,
} from 'sparkle-cli-core';
import type { LoadedSettings } from '../config/settings.js';
import { loadCliConfig, type CliArgs } from '../config/config.js';
import { loadSettings } from '../config/settings.js';

vi.mock('../config/config.js', () => ({
  loadCliConfig: vi.fn(),
}));

vi.mock('../config/settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/settings.js')>();
  return {
    ...actual,
    loadSettings: vi.fn(),
  };
});

describe('GeminiAgent - RPC Dispatcher', () => {
  let mockConfig: Mocked<Config>;
  let mockSettings: Mocked<LoadedSettings>;
  let mockArgv: CliArgs;
  let mockConnection: Mocked<acp.AgentSideConnection>;
  let agent: GeminiAgent;

  beforeEach(() => {
    mockConfig = {
      refreshAuth: vi.fn(),
      initialize: vi.fn(),
      waitForMcpInit: vi.fn(),
      getFileSystemService: vi.fn(),
      setFileSystemService: vi.fn(),
      getContentGeneratorConfig: vi.fn(),
      getActiveModel: vi.fn().mockReturnValue('gemini-pro'),
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getGeminiClient: vi.fn().mockReturnValue({
        startChat: vi.fn().mockResolvedValue({}),
      }),
      getMessageBus: vi.fn().mockReturnValue({
        publish: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      }),
      getApprovalMode: vi.fn().mockReturnValue('default'),
      isPlanEnabled: vi.fn().mockReturnValue(true),
      getCheckpointingEnabled: vi.fn().mockReturnValue(false),
      validatePathAccess: vi.fn().mockReturnValue(null),
      getWorkspaceContext: vi.fn().mockReturnValue({
        addReadOnlyPath: vi.fn(),
        getDirectories: vi.fn().mockReturnValue(['/tmp']),
      }),
      getPolicyEngine: vi.fn().mockReturnValue({
        addRule: vi.fn(),
      }),
      messageBus: {
        publish: vi.fn(),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      } as unknown as MessageBus,
      getProviderProfileService: vi.fn().mockReturnValue({
        getActiveProfile: vi.fn().mockReturnValue(undefined),
        createProfile: vi.fn().mockResolvedValue({ id: 'prof-1' }),
        updateProfile: vi.fn().mockResolvedValue(undefined),
      }),
      storage: {
        getWorkspaceAutoSavedPolicyPath: vi.fn(),
        getAutoSavedPolicyPath: vi.fn(),
      } as unknown as Storage,

      get config() {
        return this;
      },
    } as unknown as Mocked<Config>;
    mockSettings = {
      merged: {
        security: { auth: { selectedProviderId: 'prof-1', providers: [] } },
        mcpServers: {},
      },
      setValue: vi.fn(),
    } as unknown as Mocked<LoadedSettings>;
    mockArgv = {} as unknown as CliArgs;
    mockConnection = {
      sessionUpdate: vi.fn(),
      requestPermission: vi.fn(),
    } as unknown as Mocked<acp.AgentSideConnection>;

    (loadCliConfig as unknown as Mock).mockResolvedValue(mockConfig);
    (loadSettings as unknown as Mock).mockImplementation(() => ({
      merged: {
        security: {
          auth: { selectedProviderId: 'prof-1', providers: [] },
          enablePermanentToolApproval: true,
        },
        mcpServers: {},
      },
      setValue: vi.fn(),
    }));

    agent = new GeminiAgent(mockConfig, mockSettings, mockArgv, mockConnection);
  });

  it('should initialize correctly', async () => {
    const response = await agent.initialize({
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      protocolVersion: 1,
    });

    expect(response.protocolVersion).toBe(acp.PROTOCOL_VERSION);
    expect(response.authMethods).toHaveLength(1);
    expect(response.authMethods?.[0]._meta).toEqual({
      'api-key': {
        provider: 'google',
      },
    });
    expect(response.agentCapabilities?.loadSession).toBe(true);
  });

  it('should authenticate correctly', async () => {
    await agent.authenticate({
      methodId: ProviderType.USE_GEMINI,
    });

    expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
      ProviderType.USE_GEMINI,
      undefined,
      undefined,
      undefined,
    );
  });

  it('should authenticate correctly with api-key in _meta', async () => {
    await agent.authenticate({
      methodId: ProviderType.USE_GEMINI,
      _meta: {
        'api-key': 'test-api-key',
      },
    } as unknown as acp.AuthenticateRequest);

    expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
      ProviderType.USE_GEMINI,
      'test-api-key',
      undefined,
      undefined,
    );
  });

  it('should throw acp.RequestError when gateway payload is malformed', async () => {
    await expect(
      agent.authenticate({
        methodId: ProviderType.USE_GEMINI,
        _meta: {
          gateway: {
            baseUrl: 123,
            headers: { Authorization: 'Bearer token' },
          },
        },
      } as unknown as acp.AuthenticateRequest),
    ).rejects.toThrow(/Malformed gateway payload/);
  });

  it('should cancel a session', async () => {
    const mockSession = {
      cancelPendingPrompt: vi.fn(),
    };
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    await agent.cancel({ sessionId: 'test-session-id' });

    expect(mockSession.cancelPendingPrompt).toHaveBeenCalled();
  });

  it('should throw error when cancelling non-existent session', async () => {
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(undefined),
    };

    await expect(agent.cancel({ sessionId: 'unknown' })).rejects.toThrow(
      'Session not found',
    );
  });

  it('should delegate prompt to session', async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    };
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    const result = await agent.prompt({
      sessionId: 'test-session-id',
      prompt: [],
    });

    expect(mockSession.prompt).toHaveBeenCalled();
    expect(result).toMatchObject({ stopReason: 'end_turn' });
  });

  it('should delegate setMode to session', async () => {
    const mockSession = {
      setMode: vi.fn().mockReturnValue({}),
    };
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    const result = await agent.setSessionMode({
      sessionId: 'test-session-id',
      modeId: 'plan',
    });

    expect(mockSession.setMode).toHaveBeenCalledWith('plan');
    expect(result).toEqual({});
  });

  it('should throw error when setting mode on non-existent session', async () => {
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(undefined),
    };

    await expect(
      agent.setSessionMode({
        sessionId: 'unknown',
        modeId: 'plan',
      }),
    ).rejects.toThrow('Session not found: unknown');
  });

  it('should delegate setModel to session (unstable)', async () => {
    const mockSession = {
      setModel: vi.fn().mockReturnValue({}),
    };
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(mockSession),
    };

    const result = await agent.unstable_setSessionModel({
      sessionId: 'test-session-id',
      modelId: 'gemini-2.0-pro-exp',
    });

    expect(mockSession.setModel).toHaveBeenCalledWith('gemini-2.0-pro-exp');
    expect(result).toEqual({});
  });

  it('should throw error when setting model on non-existent session (unstable)', async () => {
    (
      agent as unknown as { sessionManager: { getSession: Mock } }
    ).sessionManager = {
      getSession: vi.fn().mockReturnValue(undefined),
    };

    await expect(
      agent.unstable_setSessionModel({
        sessionId: 'unknown',
        modelId: 'gemini-2.0-pro-exp',
      }),
    ).rejects.toThrow('Session not found: unknown');
  });
});
