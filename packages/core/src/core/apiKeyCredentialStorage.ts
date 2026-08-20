/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HybridTokenStorage } from '../mcp/token-storage/hybrid-token-storage.js';
import type { OAuthCredentials } from '../mcp/token-storage/types.js';
import type { ProviderProfileId } from '../config/providerProfile.js';
import { debugLogger } from '../utils/debugLogger.js';
import { createCache, type CacheService } from '../utils/cache.js';

const KEYCHAIN_SERVICE_NAME = 'sparkle-cli-api-key';

const storage = new HybridTokenStorage(KEYCHAIN_SERVICE_NAME);

// Caches to store the results of API key loads to avoid redundant keychain
// access. One cache per key entry.
const apiKeyCaches: Map<
  string,
  CacheService<string, Promise<string | null>>
> = new Map();
const storesByEntry: Map<string, ApiKeyStore> = new Map();

/**
 * A per-entry API key store backed by the system keychain.
 */
interface ApiKeyStore {
  /** Load the cached API key for this entry. */
  load(): Promise<string | null>;
  /** Save an API key for this entry. Passing null/empty clears it. */
  save(apiKey: string | null | undefined): Promise<void>;
  /** Clear the cached API key for this entry. */
  clear(): Promise<void>;
}

/**
 * Returns the keychain entry key for a provider profile.
 */
export function getProfileApiKeyEntry(profileId: ProviderProfileId): string {
  return `provider-profile:${profileId}:api-key`;
}

/**
 * Creates a per-entry API key store backed by the system keychain.
 * @internal
 */
function createApiKeyStore(entry: string): ApiKeyStore {
  const cache = createCache<string, Promise<string | null>>({
    storage: 'map',
    defaultTtl: 30000, // 30 seconds
  });
  apiKeyCaches.set(entry, cache);

  return {
    /** Load the cached API key for this entry. */
    async load(): Promise<string | null> {
      return cache.getOrCreate(entry, async () => {
        try {
          const credentials = await storage.getCredentials(entry);

          if (credentials?.token?.accessToken) {
            return credentials.token.accessToken;
          }

          return null;
        } catch (error: unknown) {
          // Log other errors but don't crash, just return null so user can re-enter key
          debugLogger.error('Failed to load API key from storage:', error);
          return null;
        }
      });
    },

    /** Save an API key for this entry. Passing null/empty clears it. */
    async save(apiKey: string | null | undefined): Promise<void> {
      cache.delete(entry);
      if (!apiKey || apiKey.trim() === '') {
        try {
          await storage.deleteCredentials(entry);
        } catch (error: unknown) {
          // Ignore errors when deleting, as it might not exist
          debugLogger.warn('Failed to delete API key from storage:', error);
        }
        return;
      }

      // Wrap API key in OAuthCredentials format as required by HybridTokenStorage
      const credentials: OAuthCredentials = {
        serverName: entry,
        token: {
          accessToken: apiKey,
          tokenType: 'ApiKey',
        },
        updatedAt: Date.now(),
      };

      await storage.setCredentials(credentials);
    },

    /** Clear the cached API key for this entry. */
    async clear(): Promise<void> {
      cache.delete(entry);
      try {
        await storage.deleteCredentials(entry);
      } catch (error: unknown) {
        debugLogger.error('Failed to clear API key from storage:', error);
        throw error;
      }
    },
  };
}

function getOrCreateStore(entry: string): ApiKeyStore {
  let store = storesByEntry.get(entry);
  if (!store) {
    store = createApiKeyStore(entry);
    storesByEntry.set(entry, store);
  }
  return store;
}

/**
 * Resets the API key caches. Used exclusively for test isolation.
 * @internal
 */
export function resetApiKeyCacheForTesting() {
  for (const cache of apiKeyCaches.values()) {
    cache.clear();
  }
  apiKeyCaches.clear();
  storesByEntry.clear();
}

/**
 * Load the cached API key for the given provider profile ID.
 */
export async function loadApiKeyForProfile(
  profileId: ProviderProfileId,
): Promise<string | null> {
  const entry = getProfileApiKeyEntry(profileId);
  return getOrCreateStore(entry).load();
}

/**
 * Save an API key for the given provider profile ID. Passing null/empty clears it.
 */
export async function saveApiKeyForProfile(
  profileId: ProviderProfileId,
  apiKey: string | null | undefined,
): Promise<void> {
  const entry = getProfileApiKeyEntry(profileId);
  return getOrCreateStore(entry).save(apiKey);
}

/**
 * Clear the cached API key for the given provider profile ID.
 */
export async function clearApiKeyForProfile(
  profileId: ProviderProfileId,
): Promise<void> {
  const entry = getProfileApiKeyEntry(profileId);
  return getOrCreateStore(entry).clear();
}
