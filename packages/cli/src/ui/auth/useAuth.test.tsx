/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { useAuthCommand, validateAuthMethodWithSettings } from './useAuth.js';
import { ProviderType, type Config } from 'sparkle-cli-core';
import { AuthState } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';

// Mock dependencies
const mockLoadApiKey = vi.fn();
const mockValidateAuthMethod = vi.fn();

vi.mock('sparkle-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sparkle-cli-core')>();
  return {
    ...actual,
    loadApiKey: () => mockLoadApiKey(),
  };
});

vi.mock('../../config/auth.js', () => ({
  validateAuthMethod: (authType: ProviderType) =>
    mockValidateAuthMethod(authType),
}));

describe('useAuth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLoadApiKey.mockResolvedValue('test-key');
    // Unset all auth env vars so tests exercise the intended path regardless
    // of the developer's shell environment. useAuth distinguishes an unset
    // variable from an empty string, so stub with `undefined` to delete it.
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', undefined as unknown as string);
    vi.stubEnv('GEMINI_API_KEY', undefined as unknown as string);
    vi.stubEnv('OPENAI_API_KEY', undefined as unknown as string);
    vi.stubEnv('GEMINI_DEFAULT_AUTH_TYPE', undefined as unknown as string);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('validateAuthMethodWithSettings', () => {
    it('should return null if useExternal is true', async () => {
      const settings = {
        merged: {
          security: {
            auth: {
              useExternal: true,
            },
          },
        },
      } as LoadedSettings;

      const error = await validateAuthMethodWithSettings(
        ProviderType.USE_OPENAI,
        settings,
      );
      expect(error).toBeNull();
    });

    it('should return null if authType is USE_GEMINI', async () => {
      const settings = {
        merged: {
          security: {
            auth: {},
          },
        },
      } as LoadedSettings;

      const error = await validateAuthMethodWithSettings(
        ProviderType.USE_GEMINI,
        settings,
      );
      expect(error).toBeNull();
    });

    it('should call validateAuthMethod for other auth types', async () => {
      const settings = {
        merged: {
          security: {
            auth: {},
          },
        },
      } as LoadedSettings;

      mockValidateAuthMethod.mockResolvedValue('Validation Error');
      const error = await validateAuthMethodWithSettings(
        ProviderType.USE_OPENAI,
        settings,
      );
      expect(error).toBe('Validation Error');
      expect(mockValidateAuthMethod).toHaveBeenCalledWith(
        ProviderType.USE_OPENAI,
      );
    });
  });

  describe('useAuthCommand', () => {
    const mockConfig = {
      refreshAuth: vi.fn(),
    } as unknown as Config;

    const createSettings = (selectedType?: ProviderType) =>
      ({
        merged: {
          security: {
            auth: {
              selectedType,
            },
          },
        },
      }) as LoadedSettings;

    let deferredRefreshAuth: {
      resolve: () => void;
      reject: (e: Error) => void;
    };

    beforeEach(() => {
      vi.mocked(mockConfig.refreshAuth).mockImplementation(
        () =>
          new Promise((resolve, reject) => {
            deferredRefreshAuth = { resolve, reject };
          }),
      );
    });

    it('should initialize with Unauthenticated state', async () => {
      const { result } = await renderHook(() =>
        useAuthCommand(createSettings(ProviderType.USE_GEMINI), mockConfig),
      );
      // Because we defer refreshAuth, the initial state is safely caught here
      expect(result.current.authState).toBe(AuthState.Unauthenticated);

      await act(async () => {
        deferredRefreshAuth.resolve();
      });

      expect(result.current.authState).toBe(AuthState.Authenticated);
    });

    it('should open the provider selection dialog if no auth type is selected and no env key', async () => {
      const { result } = await renderHook(() =>
        useAuthCommand(createSettings(undefined), mockConfig),
      );

      // The AuthDialog is shown while authState is Updating.
      expect(result.current.authState).toBe(AuthState.Updating);
      expect(result.current.authError).toBeNull();
    });

    it('should open the provider selection dialog if no auth type is selected but env key exists', async () => {
      process.env['GEMINI_API_KEY'] = 'env-key';
      const { result } = await renderHook(() =>
        useAuthCommand(createSettings(undefined), mockConfig),
      );

      expect(result.current.authState).toBe(AuthState.Updating);
      expect(result.current.authError).toBeNull();
    });

    it('should transition to AwaitingApiKeyInput if USE_GEMINI and no key found', async () => {
      let deferredLoadKey: { resolve: (k: string | null) => void };
      mockLoadApiKey.mockImplementation(
        () =>
          new Promise((resolve) => {
            deferredLoadKey = { resolve };
          }),
      );

      const { result } = await renderHook(() =>
        useAuthCommand(createSettings(ProviderType.USE_GEMINI), mockConfig),
      );

      await act(async () => {
        deferredLoadKey.resolve(null);
      });

      expect(result.current.authState).toBe(AuthState.AwaitingApiKeyInput);
    });

    it('should authenticate if USE_GEMINI and key is found', async () => {
      let deferredLoadKey: { resolve: (k: string | null) => void };
      mockLoadApiKey.mockImplementation(
        () =>
          new Promise((resolve) => {
            deferredLoadKey = { resolve };
          }),
      );

      const { result } = await renderHook(() =>
        useAuthCommand(createSettings(ProviderType.USE_GEMINI), mockConfig),
      );

      await act(async () => {
        deferredLoadKey.resolve('stored-key');
      });

      await act(async () => {
        deferredRefreshAuth.resolve();
      });

      expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
        ProviderType.USE_GEMINI,
        undefined,
        undefined,
      );
      expect(result.current.authState).toBe(AuthState.Authenticated);
      expect(result.current.apiKeyDefaultValue).toBe('stored-key');
    });

    it('should authenticate if USE_GEMINI and env key is found', async () => {
      process.env['GEMINI_API_KEY'] = 'env-key';

      const { result } = await renderHook(() =>
        useAuthCommand(createSettings(ProviderType.USE_GEMINI), mockConfig),
      );

      await act(async () => {
        deferredRefreshAuth.resolve();
      });

      expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
        ProviderType.USE_GEMINI,
        undefined,
        undefined,
      );
      expect(result.current.authState).toBe(AuthState.Authenticated);
      expect(result.current.apiKeyDefaultValue).toBe('env-key');
    });

    it('should prioritize env key over stored key when both are present', async () => {
      process.env['GEMINI_API_KEY'] = 'env-key';

      const { result } = await renderHook(() =>
        useAuthCommand(createSettings(ProviderType.USE_GEMINI), mockConfig),
      );

      await act(async () => {
        deferredRefreshAuth.resolve();
      });

      expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
        ProviderType.USE_GEMINI,
        undefined,
        undefined,
      );
      expect(result.current.authState).toBe(AuthState.Authenticated);
      expect(result.current.apiKeyDefaultValue).toBe('env-key');
    });

    it('should set error if validation fails', async () => {
      mockValidateAuthMethod.mockResolvedValue('Validation Failed');
      const { result } = await renderHook(() =>
        useAuthCommand(createSettings(ProviderType.USE_OPENAI), mockConfig),
      );

      expect(result.current.authError).toBe('Validation Failed');
      expect(result.current.authState).toBe(AuthState.Updating);
    });

    it('should set error if GEMINI_DEFAULT_AUTH_TYPE is invalid', async () => {
      process.env['GEMINI_DEFAULT_AUTH_TYPE'] = 'INVALID_TYPE';
      const { result } = await renderHook(() =>
        useAuthCommand(createSettings(ProviderType.USE_GEMINI), mockConfig),
      );

      expect(result.current.authError).toContain(
        'Invalid value for GEMINI_DEFAULT_AUTH_TYPE',
      );
      expect(result.current.authState).toBe(AuthState.Updating);
    });

    it('should authenticate successfully for valid auth type', async () => {
      const { result } = await renderHook(() =>
        useAuthCommand(createSettings(ProviderType.USE_OPENAI), mockConfig),
      );

      await act(async () => {
        deferredRefreshAuth.resolve();
      });

      expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
        ProviderType.USE_OPENAI,
        undefined,
        undefined,
      );
      expect(result.current.authState).toBe(AuthState.Authenticated);
      expect(result.current.authError).toBeNull();
    });

    it('should pass the configured base URL to refreshAuth for USE_OPENAI', async () => {
      const settings = {
        merged: {
          security: {
            auth: {
              selectedType: ProviderType.USE_OPENAI,
              openaiBaseUrl: 'https://custom.example.com/v1',
            },
          },
        },
      } as LoadedSettings;

      const { result } = await renderHook(() =>
        useAuthCommand(settings, mockConfig),
      );

      await act(async () => {
        deferredRefreshAuth.resolve();
      });

      expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
        ProviderType.USE_OPENAI,
        undefined,
        'https://custom.example.com/v1',
      );
      expect(result.current.authState).toBe(AuthState.Authenticated);
      expect(result.current.authError).toBeNull();
    });

    it('should not pass a base URL to refreshAuth for USE_OPENAI when none is configured', async () => {
      const { result } = await renderHook(() =>
        useAuthCommand(createSettings(ProviderType.USE_OPENAI), mockConfig),
      );

      await act(async () => {
        deferredRefreshAuth.resolve();
      });

      expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
        ProviderType.USE_OPENAI,
        undefined,
        undefined,
      );
      expect(result.current.authState).toBe(AuthState.Authenticated);
    });

    it('should handle refreshAuth failure', async () => {
      const { result } = await renderHook(() =>
        useAuthCommand(createSettings(ProviderType.USE_GEMINI), mockConfig),
      );

      await act(async () => {
        deferredRefreshAuth.reject(new Error('Auth Failed'));
      });

      expect(result.current.authError).toContain('Failed to sign in');
      expect(result.current.authState).toBe(AuthState.Updating);
    });
  });
});
