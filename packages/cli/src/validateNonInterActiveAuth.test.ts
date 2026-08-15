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
} from 'sparkle-cli-core';
import type { Config } from 'sparkle-cli-core';
import * as auth from './config/auth.js';

function createLocalMockConfig(overrides: Partial<Config> = {}): Config {
  const config = makeFakeConfig();
  Object.assign(config, overrides);
  return config;
}

describe('validateNonInterActiveAuth', () => {
  let debugLoggerErrorSpy: ReturnType<typeof vi.spyOn>;
  let coreEventsEmitFeedbackSpy: MockInstance;
  let processExitSpy: MockInstance;

  beforeEach(() => {
    // Unset all auth env vars so these tests exercise the "no auth" path
    // regardless of the developer's shell environment.
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
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
    vi.spyOn(auth, 'validateAuthMethod').mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('exits if no auth type is configured or env vars set', async () => {
    const nonInteractiveConfig = createLocalMockConfig({
      getOutputFormat: vi.fn().mockReturnValue(OutputFormat.TEXT),
      getContentGeneratorConfig: vi
        .fn()
        .mockReturnValue({ authType: undefined }),
    });
    try {
      await validateNonInteractiveAuth(
        undefined,
        undefined,
        nonInteractiveConfig,
      );
      expect.fail('Should have exited');
    } catch (e) {
      expect((e as Error).message).toContain(
        `process.exit(${ExitCodes.FATAL_AUTHENTICATION_ERROR}) called`,
      );
    }
    expect(debugLoggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Please set an Auth method'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(
      ExitCodes.FATAL_AUTHENTICATION_ERROR,
    );
  });

  it('uses USE_GEMINI if GEMINI_API_KEY is set', async () => {
    process.env['GEMINI_API_KEY'] = 'fake-key';
    const nonInteractiveConfig = createLocalMockConfig({});
    await validateNonInteractiveAuth(
      undefined,
      undefined,
      nonInteractiveConfig,
    );
    expect(processExitSpy).not.toHaveBeenCalled();
    expect(debugLoggerErrorSpy).not.toHaveBeenCalled();
  });

  it('uses configuredAuthType over environment variables', async () => {
    process.env['GEMINI_API_KEY'] = 'fake-key';
    const nonInteractiveConfig = createLocalMockConfig({});
    await validateNonInteractiveAuth(
      ProviderType.USE_GEMINI,
      undefined,
      nonInteractiveConfig,
    );
    expect(processExitSpy).not.toHaveBeenCalled();
    expect(debugLoggerErrorSpy).not.toHaveBeenCalled();
  });

  it('exits if validateAuthMethod returns error', async () => {
    // Mock validateAuthMethod to return error
    vi.spyOn(auth, 'validateAuthMethod').mockResolvedValue('Auth error!');
    const nonInteractiveConfig = createLocalMockConfig({
      getOutputFormat: vi.fn().mockReturnValue(OutputFormat.TEXT),
      getContentGeneratorConfig: vi
        .fn()
        .mockReturnValue({ authType: undefined }),
    });
    try {
      await validateNonInteractiveAuth(
        ProviderType.USE_GEMINI,
        undefined,
        nonInteractiveConfig,
      );
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

  it('skips validation if useExternalAuth is true', async () => {
    // Mock validateAuthMethod to return error to ensure it's not being called
    const validateAuthMethodSpy = vi
      .spyOn(auth, 'validateAuthMethod')
      .mockResolvedValue('Auth error!');
    const nonInteractiveConfig = createLocalMockConfig({});
    // Even with an invalid auth type, it should not exit
    // because validation is skipped.
    await validateNonInteractiveAuth(
      'invalid-auth-type' as ProviderType,
      true, // useExternalAuth = true
      nonInteractiveConfig,
    );

    expect(validateAuthMethodSpy).not.toHaveBeenCalled();
    expect(debugLoggerErrorSpy).not.toHaveBeenCalled();
    expect(coreEventsEmitFeedbackSpy).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  describe('JSON output mode', () => {
    it(`prints JSON error when no auth is configured and exits with code ${ExitCodes.FATAL_AUTHENTICATION_ERROR}`, async () => {
      const nonInteractiveConfig = createLocalMockConfig({
        getOutputFormat: vi.fn().mockReturnValue(OutputFormat.JSON),
        getContentGeneratorConfig: vi
          .fn()
          .mockReturnValue({ authType: undefined }),
      });

      let thrown: Error | undefined;
      try {
        await validateNonInteractiveAuth(
          undefined,
          undefined,
          nonInteractiveConfig,
        );
      } catch (e) {
        thrown = e as Error;
      }

      expect(thrown?.message).toBe(
        `process.exit(${ExitCodes.FATAL_AUTHENTICATION_ERROR}) called`,
      );
      // Checking coreEventsEmitFeedbackSpy arguments
      const errorArg = coreEventsEmitFeedbackSpy.mock.calls[0]?.[1] as string;
      const payload = JSON.parse(errorArg);
      expect(payload.error.type).toBe('Error');
      expect(payload.error.code).toBe(ExitCodes.FATAL_AUTHENTICATION_ERROR);
      expect(payload.error.message).toContain(
        'Please set an Auth method in your',
      );
    });

    it(`prints JSON error when validateAuthMethod fails and exits with code ${ExitCodes.FATAL_AUTHENTICATION_ERROR}`, async () => {
      vi.spyOn(auth, 'validateAuthMethod').mockResolvedValue('Auth error!');
      process.env['GEMINI_API_KEY'] = 'fake-key';

      const nonInteractiveConfig = createLocalMockConfig({
        getOutputFormat: vi.fn().mockReturnValue(OutputFormat.JSON),
        getContentGeneratorConfig: vi
          .fn()
          .mockReturnValue({ authType: undefined }),
      });

      let thrown: Error | undefined;
      try {
        await validateNonInteractiveAuth(
          ProviderType.USE_GEMINI,
          undefined,
          nonInteractiveConfig,
        );
      } catch (e) {
        thrown = e as Error;
      }

      expect(thrown?.message).toBe(
        `process.exit(${ExitCodes.FATAL_AUTHENTICATION_ERROR}) called`,
      );
      {
        // Checking coreEventsEmitFeedbackSpy arguments
        const errorArg = coreEventsEmitFeedbackSpy.mock.calls[0]?.[1] as string;
        const payload = JSON.parse(errorArg);
        expect(payload.error.type).toBe('Error');
        expect(payload.error.code).toBe(ExitCodes.FATAL_AUTHENTICATION_ERROR);
        expect(payload.error.message).toBe('Auth error!');
      }
    });
  });
});
