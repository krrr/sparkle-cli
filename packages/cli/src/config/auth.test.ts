/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ProviderType,
  loadApiKeyForProfile,
  type ProviderProfile,
} from 'sparkle-cli-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateProfileAuth } from './auth.js';

vi.mock('sparkle-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sparkle-cli-core')>();
  return {
    ...actual,
    loadApiKeyForProfile: vi.fn(),
  };
});

vi.mock('./settings.js', () => ({
  loadEnvironment: vi.fn(),
  loadSettings: vi.fn().mockReturnValue({
    merged: vi.fn().mockReturnValue({}),
  }),
}));

describe('validateProfileAuth', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', undefined);
    vi.stubEnv('OPENAI_API_KEY', undefined);
    vi.mocked(loadApiKeyForProfile).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('USE_GEMINI', () => {
    const baseGeminiProfile: ProviderProfile = {
      id: 'gemini-profile',
      providerType: ProviderType.USE_GEMINI,
      models: [{ id: 'gemini-2.5-flash' }],
    };

    it('should return null if GEMINI_API_KEY is set in environment', async () => {
      vi.stubEnv('GEMINI_API_KEY', 'env-key');
      const result = await validateProfileAuth(baseGeminiProfile);
      expect(result).toBeNull();
    });

    it('should return null if API key is stored in keychain', async () => {
      vi.mocked(loadApiKeyForProfile).mockResolvedValue('keychain-key');
      const result = await validateProfileAuth(baseGeminiProfile);
      expect(result).toBeNull();
      expect(loadApiKeyForProfile).toHaveBeenCalledWith('gemini-profile');
    });

    it('should return null if baseUrl is configured (custom gateway endpoint)', async () => {
      const customGatewayProfile: ProviderProfile = {
        ...baseGeminiProfile,
        baseUrl: 'https://gateway.example.com',
      };
      const result = await validateProfileAuth(customGatewayProfile);
      expect(result).toBeNull();
    });

    it('should return error message when neither API key nor baseUrl is configured', async () => {
      const result = await validateProfileAuth(baseGeminiProfile);
      expect(result).toBe(
        'When using Gemini API, you must specify the GEMINI_API_KEY environment variable or configure an API key.\n' +
          'Update your environment and try again (no reload needed if using .env)!',
      );
    });
  });

  describe('USE_OPENAI', () => {
    const baseOpenAiProfile: ProviderProfile = {
      id: 'openai-profile',
      providerType: ProviderType.USE_OPENAI,
      models: [{ id: 'gpt-4o' }],
    };

    it('should return null even if OPENAI_API_KEY is not set', async () => {
      const result = await validateProfileAuth(baseOpenAiProfile);
      expect(result).toBeNull();
    });

    it('should return null if OPENAI_API_KEY is set', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'env-openai-key');
      const result = await validateProfileAuth(baseOpenAiProfile);
      expect(result).toBeNull();
    });
  });

  it('should return an error message for an invalid provider type', async () => {
    const invalidProfile = {
      id: 'invalid-profile',
      name: 'Invalid',
      providerType: 'invalid-provider' as unknown as ProviderType,
      models: [],
    };
    const result = await validateProfileAuth(invalidProfile);
    expect(result).toBe('Invalid auth method selected.');
  });
});
