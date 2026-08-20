/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderType } from './constants.js';

export type ProviderProfileId = string;

export interface ProviderModel {
  id: string;
  aliases?: string[];

  // Optional capabilities for routing and UI
  contextWindow?: number;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
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
