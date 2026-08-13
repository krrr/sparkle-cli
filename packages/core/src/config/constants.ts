/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface FileFilteringOptions {
  respectGitIgnore: boolean;
  respectSparkleIgnore: boolean;
  enableFileWatcher?: boolean;
  maxFileCount?: number;
  searchTimeout?: number;
  customIgnoreFilePaths: string[];
}

// For memory files
export const DEFAULT_MEMORY_FILE_FILTERING_OPTIONS: FileFilteringOptions = {
  respectGitIgnore: false,
  respectSparkleIgnore: true,
  enableFileWatcher: false,
  maxFileCount: 20000,
  searchTimeout: 5000,
  customIgnoreFilePaths: [],
};

// For all other files
export const DEFAULT_FILE_FILTERING_OPTIONS: FileFilteringOptions = {
  respectGitIgnore: true,
  respectSparkleIgnore: true,
  enableFileWatcher: false,
  maxFileCount: 20000,
  searchTimeout: 5000,
  customIgnoreFilePaths: [],
};

// Generic exclusion file name
export const SPARKLE_IGNORE_FILE_NAME = '.sparkleignore';

// Extension integrity constants
export const INTEGRITY_FILENAME = 'extension_integrity.json';
export const INTEGRITY_KEY_FILENAME = 'integrity.key';
export const KEYCHAIN_SERVICE_NAME = 'sparkle-cli-extension-integrity';
export const SECRET_KEY_ACCOUNT = 'secret-key';

/**
 * The provider/auth backend used to reach the LLM.
 *
 * Values are persisted (used as keychain store entries and settings values),
 * so they must not change.
 */
export enum ProviderType {
  USE_GEMINI = 'gemini-api-key',
  GATEWAY = 'gateway',
  USE_OPENAI = 'openai-api-key',
}

/**
 * Detects the best provider type based on environment variables.
 *
 * Checks in order:
 * 1. GOOGLE_GEMINI_BASE_URL -> GATEWAY
 * 2. GEMINI_API_KEY -> USE_GEMINI
 * 3. OPENAI_API_KEY -> USE_OPENAI
 */
export function getProviderTypeFromEnv(): ProviderType | undefined {
  if (process.env['GOOGLE_GEMINI_BASE_URL']) {
    return ProviderType.GATEWAY;
  }
  if (process.env['GEMINI_API_KEY']) {
    return ProviderType.USE_GEMINI;
  }
  if (process.env['OPENAI_API_KEY']) {
    return ProviderType.USE_OPENAI;
  }
  return undefined;
}
