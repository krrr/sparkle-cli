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

/**
 * Thinking effort levels accepted by OpenAI-compatible providers. The union
 * covers the values used across providers (OpenAI, DeepSeek, GLM, ...);
 * providers that reject a level will surface the error. `none` is special:
 * it disables thinking entirely (e.g. DeepSeek's
 * `extra_body.thinking.type = "disabled"`).
 */
export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

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
  // Per-model sampling parameters. Applied via a model-matched override to
  // every request keyed by this model's id. No UI for temperature/topP yet;
  // they are honored when set directly in settings.json.
  generateConfig?: {
    temperature?: number;
    topP?: number;
    reasoningEffort?: ReasoningEffort;
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
