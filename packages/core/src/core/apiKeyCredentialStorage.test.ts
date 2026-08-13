/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderType } from '../config/constants.js';
import {
  loadApiKey,
  saveApiKey,
  clearApiKey,
  resetApiKeyCacheForTesting,
} from './apiKeyCredentialStorage.js';

const getCredentialsMock = vi.hoisted(() => vi.fn());
const setCredentialsMock = vi.hoisted(() => vi.fn());
const deleteCredentialsMock = vi.hoisted(() => vi.fn());

vi.mock('../mcp/token-storage/hybrid-token-storage.js', () => ({
  HybridTokenStorage: vi.fn().mockImplementation(() => ({
    getCredentials: getCredentialsMock,
    setCredentials: setCredentialsMock,
    deleteCredentials: deleteCredentialsMock,
  })),
}));

const GEMINI_ENTRY = 'gemini-api-key';
const OPENAI_ENTRY = 'openai-api-key';

describe('ApiKeyCredentialStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApiKeyCacheForTesting();
  });

  describe('Gemini API key entry (ProviderType.USE_GEMINI)', () => {
    it('should load an API key and cache it', async () => {
      getCredentialsMock.mockResolvedValue({
        serverName: GEMINI_ENTRY,
        token: {
          accessToken: 'test-key',
          tokenType: 'ApiKey',
        },
        updatedAt: Date.now(),
      });

      const apiKey1 = await loadApiKey(ProviderType.USE_GEMINI);
      expect(apiKey1).toBe('test-key');
      expect(getCredentialsMock).toHaveBeenCalledTimes(1);
      expect(getCredentialsMock).toHaveBeenCalledWith(GEMINI_ENTRY);

      const apiKey2 = await loadApiKey(ProviderType.USE_GEMINI);
      expect(apiKey2).toBe('test-key');
      expect(getCredentialsMock).toHaveBeenCalledTimes(1); // Should be cached
    });

    it('should return null if no API key is stored and cache it', async () => {
      getCredentialsMock.mockResolvedValue(null);
      const apiKey1 = await loadApiKey(ProviderType.USE_GEMINI);
      expect(apiKey1).toBeNull();
      expect(getCredentialsMock).toHaveBeenCalledTimes(1);

      const apiKey2 = await loadApiKey(ProviderType.USE_GEMINI);
      expect(apiKey2).toBeNull();
      expect(getCredentialsMock).toHaveBeenCalledTimes(1); // Should be cached
    });

    it('should save an API key and clear cache', async () => {
      getCredentialsMock.mockResolvedValue({
        serverName: GEMINI_ENTRY,
        token: {
          accessToken: 'old-key',
          tokenType: 'ApiKey',
        },
        updatedAt: Date.now(),
      });

      await loadApiKey(ProviderType.USE_GEMINI);
      expect(getCredentialsMock).toHaveBeenCalledTimes(1);

      await saveApiKey(ProviderType.USE_GEMINI, 'new-key');
      expect(setCredentialsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          serverName: GEMINI_ENTRY,
          token: expect.objectContaining({
            accessToken: 'new-key',
            tokenType: 'ApiKey',
          }),
        }),
      );

      getCredentialsMock.mockResolvedValue({
        serverName: GEMINI_ENTRY,
        token: {
          accessToken: 'new-key',
          tokenType: 'ApiKey',
        },
        updatedAt: Date.now(),
      });

      await loadApiKey(ProviderType.USE_GEMINI);
      expect(getCredentialsMock).toHaveBeenCalledTimes(2); // Should have fetched again
    });

    it('should clear an API key and clear cache', async () => {
      getCredentialsMock.mockResolvedValue({
        serverName: GEMINI_ENTRY,
        token: {
          accessToken: 'old-key',
          tokenType: 'ApiKey',
        },
        updatedAt: Date.now(),
      });

      await loadApiKey(ProviderType.USE_GEMINI);
      expect(getCredentialsMock).toHaveBeenCalledTimes(1);

      await clearApiKey(ProviderType.USE_GEMINI);
      expect(deleteCredentialsMock).toHaveBeenCalledWith(GEMINI_ENTRY);

      getCredentialsMock.mockResolvedValue(null);
      await loadApiKey(ProviderType.USE_GEMINI);
      expect(getCredentialsMock).toHaveBeenCalledTimes(2); // Should have fetched again
    });

    it('should clear an API key and cache when saving empty key', async () => {
      await saveApiKey(ProviderType.USE_GEMINI, '');
      expect(deleteCredentialsMock).toHaveBeenCalledWith(GEMINI_ENTRY);
      expect(setCredentialsMock).not.toHaveBeenCalled();
    });

    it('should clear an API key and cache when saving null key', async () => {
      await saveApiKey(ProviderType.USE_GEMINI, null);
      expect(deleteCredentialsMock).toHaveBeenCalledWith(GEMINI_ENTRY);
      expect(setCredentialsMock).not.toHaveBeenCalled();
    });

    it('should not throw when clearing an API key fails during saveApiKey', async () => {
      deleteCredentialsMock.mockRejectedValueOnce(
        new Error('Failed to delete'),
      );
      await expect(
        saveApiKey(ProviderType.USE_GEMINI, ''),
      ).resolves.not.toThrow();
      expect(deleteCredentialsMock).toHaveBeenCalledWith(GEMINI_ENTRY);
    });

    it('should not throw when clearing an API key fails during clearApiKey', async () => {
      deleteCredentialsMock.mockRejectedValueOnce(
        new Error('Failed to delete'),
      );
      await expect(clearApiKey(ProviderType.USE_GEMINI)).resolves.not.toThrow();
      expect(deleteCredentialsMock).toHaveBeenCalledWith(GEMINI_ENTRY);
    });
  });

  describe('OpenAI API key entry (ProviderType.USE_OPENAI)', () => {
    it('should load an OpenAI API key and cache it', async () => {
      getCredentialsMock.mockResolvedValue({
        serverName: OPENAI_ENTRY,
        token: {
          accessToken: 'sk-test-key',
          tokenType: 'ApiKey',
        },
        updatedAt: Date.now(),
      });

      const apiKey1 = await loadApiKey(ProviderType.USE_OPENAI);
      expect(apiKey1).toBe('sk-test-key');
      expect(getCredentialsMock).toHaveBeenCalledTimes(1);
      expect(getCredentialsMock).toHaveBeenCalledWith(OPENAI_ENTRY);

      const apiKey2 = await loadApiKey(ProviderType.USE_OPENAI);
      expect(apiKey2).toBe('sk-test-key');
      expect(getCredentialsMock).toHaveBeenCalledTimes(1); // Should be cached
    });

    it('should return null if no OpenAI API key is stored', async () => {
      getCredentialsMock.mockResolvedValue(null);
      await expect(loadApiKey(ProviderType.USE_OPENAI)).resolves.toBeNull();
    });

    it('should save an OpenAI API key under the openai-api-key entry', async () => {
      await saveApiKey(ProviderType.USE_OPENAI, 'sk-new-key');
      expect(setCredentialsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          serverName: OPENAI_ENTRY,
          token: expect.objectContaining({
            accessToken: 'sk-new-key',
            tokenType: 'ApiKey',
          }),
        }),
      );
    });

    it('should clear the OpenAI API key and cache when saving empty key', async () => {
      await saveApiKey(ProviderType.USE_OPENAI, '');
      expect(deleteCredentialsMock).toHaveBeenCalledWith(OPENAI_ENTRY);
      expect(setCredentialsMock).not.toHaveBeenCalled();
    });

    it('should clear the OpenAI API key via clearApiKey', async () => {
      await clearApiKey(ProviderType.USE_OPENAI);
      expect(deleteCredentialsMock).toHaveBeenCalledWith(OPENAI_ENTRY);
    });
  });

  it('should keep the Gemini and OpenAI API keys in separate entries', async () => {
    await saveApiKey(ProviderType.USE_GEMINI, 'gemini-key');
    await saveApiKey(ProviderType.USE_OPENAI, 'openai-key');
    expect(setCredentialsMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ serverName: GEMINI_ENTRY }),
    );
    expect(setCredentialsMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ serverName: OPENAI_ENTRY }),
    );

    getCredentialsMock
      .mockResolvedValueOnce({
        serverName: GEMINI_ENTRY,
        token: { accessToken: 'gemini-key', tokenType: 'ApiKey' },
        updatedAt: Date.now(),
      })
      .mockResolvedValueOnce({
        serverName: OPENAI_ENTRY,
        token: { accessToken: 'openai-key', tokenType: 'ApiKey' },
        updatedAt: Date.now(),
      });

    await expect(loadApiKey(ProviderType.USE_GEMINI)).resolves.toBe(
      'gemini-key',
    );
    await expect(loadApiKey(ProviderType.USE_OPENAI)).resolves.toBe(
      'openai-key',
    );
  });
});
