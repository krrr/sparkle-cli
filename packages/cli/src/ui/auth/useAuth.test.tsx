/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { useAuthCommand } from './useAuth.js';
import {
  ProviderType,
  type Config,
  type ProviderProfile,
} from 'sparkle-cli-core';
import { AuthState } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';

// Mock dependencies
const mockLoadApiKeyForProfile = vi.fn();
const mockValidateProfileAuth = vi.fn();

vi.mock('sparkle-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sparkle-cli-core')>();
  return {
    ...actual,
    loadApiKeyForProfile: () => mockLoadApiKeyForProfile(),
  };
});

vi.mock('../../config/auth.js', () => ({
  validateProfileAuth: (profile: ProviderProfile) =>
    mockValidateProfileAuth(profile),
}));

describe('useAuth', () => {
  const fakeProfile: ProviderProfile = {
    id: 'test-profile-1',
    providerType: ProviderType.USE_GEMINI,
    models: [{ id: 'gemini-2.5-flash' }],
    defaultModel: 'gemini-2.5-flash',
  };

  let mockProfileService: {
    getActiveProfile: ReturnType<typeof vi.fn>;
    activateProfile: ReturnType<typeof vi.fn>;
  };
  let mockConfig: Config;
  let mockSettings: LoadedSettings;

  beforeEach(() => {
    vi.resetAllMocks();
    mockLoadApiKeyForProfile.mockResolvedValue('test-key');
    mockValidateProfileAuth.mockResolvedValue(null);

    mockProfileService = {
      getActiveProfile: vi.fn().mockReturnValue(fakeProfile),
      activateProfile: vi.fn().mockResolvedValue(undefined),
    };

    mockConfig = {
      getProviderProfileService: vi.fn().mockReturnValue(mockProfileService),
    } as unknown as Config;

    mockSettings = {
      merged: {
        security: {
          auth: {
            selectedProviderId: fakeProfile.id,
            providers: [fakeProfile],
          },
        },
      },
    } as unknown as LoadedSettings;

    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', undefined as unknown as string);
    vi.stubEnv('GEMINI_API_KEY', undefined as unknown as string);
    vi.stubEnv('OPENAI_API_KEY', undefined as unknown as string);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('useAuthCommand', () => {
    it('should open provider dialog if no active profile exists', async () => {
      mockProfileService.getActiveProfile.mockReturnValue(undefined);

      const { result } = await renderHook(() =>
        useAuthCommand(mockSettings, mockConfig),
      );

      expect(result.current.authState).toBe(AuthState.Updating);
      expect(result.current.authError).toBeNull();
    });

    it('should authenticate if active profile is present and valid', async () => {
      let deferredActivate: {
        resolve: () => void;
        reject: (e: Error) => void;
      };
      mockProfileService.activateProfile.mockImplementation(
        () =>
          new Promise<void>((resolve, reject) => {
            deferredActivate = { resolve, reject };
          }),
      );

      const { result } = await renderHook(() =>
        useAuthCommand(mockSettings, mockConfig),
      );

      await act(async () => {
        deferredActivate.resolve();
      });

      expect(mockProfileService.activateProfile).toHaveBeenCalledWith(
        fakeProfile.id,
      );
      expect(result.current.authState).toBe(AuthState.Authenticated);
      expect(result.current.authError).toBeNull();
    });

    it('should set error if validation fails', async () => {
      mockValidateProfileAuth.mockResolvedValue('Validation Failed');
      const { result } = await renderHook(() =>
        useAuthCommand(mockSettings, mockConfig),
      );

      expect(result.current.authError).toBe('Validation Failed');
      expect(result.current.authState).toBe(AuthState.Updating);
    });

    it('should handle activateProfile failure', async () => {
      mockProfileService.activateProfile.mockRejectedValue(
        new Error('Auth Failed'),
      );

      const { result } = await renderHook(() =>
        useAuthCommand(mockSettings, mockConfig),
      );

      expect(result.current.authError).toContain('Failed to sign in');
      expect(result.current.authState).toBe(AuthState.Updating);
    });
  });
});
