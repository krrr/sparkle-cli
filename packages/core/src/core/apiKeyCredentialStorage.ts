/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HybridTokenStorage } from '../mcp/token-storage/hybrid-token-storage.js';
import type { OAuthCredentials } from '../mcp/token-storage/types.js';
import { ProviderType } from '../config/constants.js';
import { debugLogger } from '../utils/debugLogger.js';
import { createCache, type CacheService } from '../utils/cache.js';

const KEYCHAIN_SERVICE_NAME = 'sparkle-cli-api-key';
const GEMINI_API_KEY_ENTRY = 'gemini-api-key';
const OPENAI_API_KEY_ENTRY = 'openai-api-key';

const storage = new HybridTokenStorage(KEYCHAIN_SERVICE_NAME);

// Caches to store the results of API key loads to avoid redundant keychain
// access. One cache per key entry.
const apiKeyCaches: Array<CacheService<string, Promise<string | null>>> = [];

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
 * Creates a per-entry API key store backed by the system keychain.
 * @internal
 */
function createApiKeyStore(entry: string): ApiKeyStore {
  const cache = createCache<string, Promise<string | null>>({
    storage: 'map',
    defaultTtl: 30000, // 30 seconds
  });
  apiKeyCaches.push(cache);

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
      }
    },
  };
}

const geminiApiKeyStore = createApiKeyStore(GEMINI_API_KEY_ENTRY);
const openAiApiKeyStore = createApiKeyStore(OPENAI_API_KEY_ENTRY);

/**
 * Maps an auth type to its key store.
 */
const STORE_BY_AUTH_TYPE: Record<ProviderType, ApiKeyStore> = {
  [ProviderType.USE_GEMINI]: geminiApiKeyStore,
  [ProviderType.USE_OPENAI]: openAiApiKeyStore,
};

/**
 * Resets the API key caches. Used exclusively for test isolation.
 * @internal
 */
export function resetApiKeyCacheForTesting() {
  for (const cache of apiKeyCaches) {
    cache.clear();
  }
}

/**
 * Load the cached API key for the given auth type.
 */
export async function loadApiKey(type: ProviderType): Promise<string | null> {
  return STORE_BY_AUTH_TYPE[type].load();
}

/**
 * Save an API key for the given auth type. Passing null/empty clears it.
 */
export async function saveApiKey(
  type: ProviderType,
  apiKey: string | null | undefined,
): Promise<void> {
  return STORE_BY_AUTH_TYPE[type].save(apiKey);
}

/**
 * Clear the cached API key for the given auth type.
 */
export async function clearApiKey(type: ProviderType): Promise<void> {
  return STORE_BY_AUTH_TYPE[type].clear();
}
