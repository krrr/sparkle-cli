/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderType } from './constants.js';
import type {
  SPARKLE_MODEL_ALIAS_PRO,
  SPARKLE_MODEL_ALIAS_FLASH,
  SPARKLE_MODEL_ALIAS_FLASH_LITE,
} from './models.js';

export type ProviderProfileId = string;
export type ModelTier =
  | typeof SPARKLE_MODEL_ALIAS_PRO
  | typeof SPARKLE_MODEL_ALIAS_FLASH
  | typeof SPARKLE_MODEL_ALIAS_FLASH_LITE;

export interface ProviderModel {
  id: string;
  tier?: ModelTier;

  // Optional capabilities for routing and UI
  // Passing to ModelDefinition.features
  contextWindow?: number;
  features?: {
    thinking?: boolean;
    toolUse?: boolean;
    multimodalToolUse?: boolean;
  };
  // for future use
  generateConfig?: {
    temperature?: number;
    topP?: number;
  };
}

export interface ProviderProfile {
  id: ProviderProfileId;
  providerType: ProviderType;

  baseUrl?: string;
  customHeaders?: Record<string, string>;

  models: ProviderModel[];
  defaultModel?: string;
}

export interface CreateProviderProfileInput {
  id: ProviderProfileId;
  providerType: ProviderType;

  baseUrl?: string;
  customHeaders?: Record<string, string>;

  models?: ProviderModel[];
  defaultModel?: string;
}

export interface UpdateProviderProfileInput {
  id?: ProviderProfileId;
  providerType?: ProviderType;

  baseUrl?: string;
  customHeaders?: Record<string, string>;

  models?: ProviderModel[];
  defaultModel?: string;
}

export interface ProfileStorageDelegate {
  getProfiles: () => ProviderProfile[];
  getSelectedProfileId: () => ProviderProfileId | undefined;
  saveProfiles: (
    profiles: ProviderProfile[],
    selectedProfileId?: ProviderProfileId,
  ) => Promise<void> | void;
}
