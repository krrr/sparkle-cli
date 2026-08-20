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
  afterEach,
  type MockInstance,
} from 'vitest';
import { validateNonInteractiveAuth } from './validateNonInterActiveAuth.js';
import {
  ProviderType,
  OutputFormat,
  makeFakeConfig,
  debugLogger,
  ExitCodes,
  coreEvents,
  type ProviderProfile,
  type Config,
} from 'sparkle-cli-core';

describe('validateNonInterActiveAuth', () => {
  let debugLoggerErrorSpy: ReturnType<typeof vi.spyOn>;
  let coreEventsEmitFeedbackSpy: MockInstance;
  let processExitSpy: MockInstance;

  let mockProfileService: {
    getActiveProfile: ReturnType<typeof vi.fn>;
    activateProfile: ReturnType<typeof vi.fn>;
    createProfile: ReturnType<typeof vi.fn>;
  };

  const fakeProfile: ProviderProfile = {
    id: 'test-profile-1',
    providerType: ProviderType.USE_GEMINI,
    models: [{ id: 'gemini-2.5-flash' }],
    defaultModel: 'gemini-2.5-flash',
  };

  function createLocalMockConfig(overrides: Partial<Config> = {}): Config {
    const config = makeFakeConfig();
    Object.assign(config, overrides);
    (config as unknown as Record<string, unknown>)[
      'getProviderProfileService'
    ] = vi.fn().mockReturnValue(mockProfileService);
    return config;
  }

  beforeEach(() => {
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    mockProfileService = {
      getActiveProfile: vi.fn().mockReturnValue(fakeProfile),
      activateProfile: vi.fn().mockResolvedValue(undefined),
      createProfile: vi.fn().mockResolvedValue({
        id: 'transient-1',
        providerType: ProviderType.USE_GEMINI,
      }),
    };
    debugLoggerErrorSpy = vi
      .spyOn(debugLogger, 'error')
      .mockImplementation(() => {});
    coreEventsEmitFeedbackSpy = vi
      .spyOn(coreEvents, 'emitFeedback')
      .mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit(${code}) called`);
      });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('exits if no profile is configured or env vars set', async () => {
    mockProfileService.getActiveProfile.mockReturnValue(undefined);
    const nonInteractiveConfig = createLocalMockConfig({
      getOutputFormat: vi.fn().mockReturnValue(OutputFormat.TEXT),
    });
    try {
      await validateNonInteractiveAuth(nonInteractiveConfig);
      expect.fail('Should have exited');
    } catch (e) {
      expect((e as Error).message).toContain(
        `process.exit(${ExitCodes.FATAL_AUTHENTICATION_ERROR}) called`,
      );
    }
    expect(debugLoggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Please configure a provider'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(
      ExitCodes.FATAL_AUTHENTICATION_ERROR,
    );
  });

  it('creates transient profile and uses USE_GEMINI if GEMINI_API_KEY is set and no active profile', async () => {
    mockProfileService.getActiveProfile.mockReturnValue(undefined);
    process.env['GEMINI_API_KEY'] = 'fake-key';
    const nonInteractiveConfig = createLocalMockConfig({});
    await validateNonInteractiveAuth(nonInteractiveConfig);
    expect(processExitSpy).not.toHaveBeenCalled();
    expect(mockProfileService.createProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: ProviderType.USE_GEMINI,
      }),
    );
    expect(mockProfileService.activateProfile).toHaveBeenCalledWith(
      'transient-1',
    );
  });

  it('activates existing active profile when present', async () => {
    const nonInteractiveConfig = createLocalMockConfig({});
    await validateNonInteractiveAuth(nonInteractiveConfig);
    expect(processExitSpy).not.toHaveBeenCalled();
    expect(mockProfileService.activateProfile).toHaveBeenCalledWith(
      fakeProfile.id,
    );
  });

  it('exits if activateProfile fails', async () => {
    mockProfileService.activateProfile.mockRejectedValue(
      new Error('Auth error!'),
    );
    const nonInteractiveConfig = createLocalMockConfig({
      getOutputFormat: vi.fn().mockReturnValue(OutputFormat.TEXT),
    });
    try {
      await validateNonInteractiveAuth(nonInteractiveConfig);
      expect.fail('Should have exited');
    } catch (e) {
      expect((e as Error).message).toContain(
        `process.exit(${ExitCodes.FATAL_AUTHENTICATION_ERROR}) called`,
      );
    }
    expect(debugLoggerErrorSpy).toHaveBeenCalledWith('Auth error!');
    expect(processExitSpy).toHaveBeenCalledWith(
      ExitCodes.FATAL_AUTHENTICATION_ERROR,
    );
  });

  describe('JSON output mode', () => {
    it(`prints JSON error when no auth is configured and exits with code ${ExitCodes.FATAL_AUTHENTICATION_ERROR}`, async () => {
      mockProfileService.getActiveProfile.mockReturnValue(undefined);
      const nonInteractiveConfig = createLocalMockConfig({
        getOutputFormat: vi.fn().mockReturnValue(OutputFormat.JSON),
      });

      try {
        await validateNonInteractiveAuth(nonInteractiveConfig);
      } catch {
        // Expected process.exit throw
      }

      const errorArg = coreEventsEmitFeedbackSpy.mock.calls[0]?.[1] as string;
      const payload = JSON.parse(errorArg);
      expect(payload.error.type).toBe('Error');
      expect(payload.error.code).toBe(ExitCodes.FATAL_AUTHENTICATION_ERROR);
      expect(payload.error.message).toContain(
        'Please configure a provider in your',
      );
    });

    it(`prints JSON error when activateProfile fails and exits with code ${ExitCodes.FATAL_AUTHENTICATION_ERROR}`, async () => {
      mockProfileService.activateProfile.mockRejectedValue(
        new Error('Auth error!'),
      );

      const nonInteractiveConfig = createLocalMockConfig({
        getOutputFormat: vi.fn().mockReturnValue(OutputFormat.JSON),
      });

      try {
        await validateNonInteractiveAuth(nonInteractiveConfig);
      } catch {
        // Expected process.exit throw
      }

      const errorArg = coreEventsEmitFeedbackSpy.mock.calls[0]?.[1] as string;
      const payload = JSON.parse(errorArg);
      expect(payload.error.type).toBe('Error');
      expect(payload.error.code).toBe(ExitCodes.FATAL_AUTHENTICATION_ERROR);
      expect(payload.error.message).toBe('Auth error!');
    });
  });
});
