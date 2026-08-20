/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadApiKeyForProfile,
  saveApiKeyForProfile,
  clearApiKeyForProfile,
  getProfileApiKeyEntry,
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

describe('ApiKeyCredentialStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetApiKeyCacheForTesting();
  });

  describe('Provider Profile API key storage', () => {
    const profileId = 'profile_123';
    const entry = getProfileApiKeyEntry(profileId);

    it('should format profile keychain entry correctly', () => {
      expect(entry).toBe('provider-profile:profile_123:api-key');
    });

    it('should load profile API key and cache it', async () => {
      getCredentialsMock.mockResolvedValue({
        serverName: entry,
        token: {
          accessToken: 'prof-secret-key',
          tokenType: 'ApiKey',
        },
        updatedAt: Date.now(),
      });

      const key1 = await loadApiKeyForProfile(profileId);
      expect(key1).toBe('prof-secret-key');
      expect(getCredentialsMock).toHaveBeenCalledTimes(1);
      expect(getCredentialsMock).toHaveBeenCalledWith(entry);

      const key2 = await loadApiKeyForProfile(profileId);
      expect(key2).toBe('prof-secret-key');
      expect(getCredentialsMock).toHaveBeenCalledTimes(1); // Cached
    });

    it('should return null when profile has no stored key', async () => {
      getCredentialsMock.mockResolvedValue(null);
      const key = await loadApiKeyForProfile(profileId);
      expect(key).toBeNull();
      expect(getCredentialsMock).toHaveBeenCalledWith(entry);
    });

    it('should save profile API key and invalidate cache', async () => {
      await saveApiKeyForProfile(profileId, 'new-prof-key');
      expect(setCredentialsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          serverName: entry,
          token: expect.objectContaining({
            accessToken: 'new-prof-key',
            tokenType: 'ApiKey',
          }),
        }),
      );
    });

    it('should clear profile API key', async () => {
      await clearApiKeyForProfile(profileId);
      expect(deleteCredentialsMock).toHaveBeenCalledWith(entry);
    });

    it('should separate keys for different profiles', async () => {
      const p1 = 'profile_a';
      const p2 = 'profile_b';
      await saveApiKeyForProfile(p1, 'key-a');
      await saveApiKeyForProfile(p2, 'key-b');

      expect(setCredentialsMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ serverName: getProfileApiKeyEntry(p1) }),
      );
      expect(setCredentialsMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ serverName: getProfileApiKeyEntry(p2) }),
      );
    });

    it('should throw when clearApiKeyForProfile fails', async () => {
      deleteCredentialsMock.mockRejectedValueOnce(
        new Error('Failed to delete'),
      );
      await expect(clearApiKeyForProfile('p1')).rejects.toThrow(
        'Failed to delete',
      );
    });
  });
});
