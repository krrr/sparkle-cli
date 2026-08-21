/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProviderType } from '../config/constants.js';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
} from '../config/models.js';
import {
  type ProviderProfile,
  type ProviderProfileId,
  type ProviderModel,
  type CreateProviderProfileInput,
  type UpdateProviderProfileInput,
  type ProfileStorageDelegate,
} from '../config/providerProfile.js';
import {
  loadApiKeyForProfile,
  saveApiKeyForProfile,
  clearApiKeyForProfile,
} from '../core/apiKeyCredentialStorage.js';
import type { Config } from '../config/config.js';
import { coreEvents } from '../utils/events.js';

export const PROFILE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

export function validateProfileId(id: string): void {
  const trimmed = id.trim();
  if (!trimmed) {
    throw new Error('Provider profile ID is required.');
  }
  if (!PROFILE_ID_REGEX.test(trimmed)) {
    throw new Error(
      `Invalid profile ID "${trimmed}". Only letters, numbers, underscores (_), and hyphens (-) are allowed.`,
    );
  }
}

export type { ProfileStorageDelegate };

export interface ProviderProfileServiceOptions {
  config: Config;
  storageDelegate?: ProfileStorageDelegate;
  env?: Record<string, string | undefined>;
}

export class ProviderProfileService {
  private readonly config: Config;
  private storageDelegate: ProfileStorageDelegate;
  private inMemoryProfiles: ProviderProfile[] = [];
  private inMemorySelectedId: ProviderProfileId | undefined = undefined;
  private readonly env: Record<string, string | undefined>;

  constructor(options: ProviderProfileServiceOptions) {
    this.config = options.config;
    this.env = options.env || process.env;

    this.storageDelegate = options.storageDelegate || {
      getProfiles: () => this.inMemoryProfiles,
      getSelectedProfileId: () => this.inMemorySelectedId,
      saveProfiles: (profiles, selectedProfileId) => {
        this.inMemoryProfiles = [...profiles];
        this.inMemorySelectedId = selectedProfileId;
      },
    };
  }

  setStorageDelegate(delegate: ProfileStorageDelegate): void {
    this.storageDelegate = delegate;
  }

  listProfiles(): ProviderProfile[] {
    return [...this.storageDelegate.getProfiles()];
  }

  getProfile(id: ProviderProfileId): ProviderProfile | undefined {
    return this.storageDelegate.getProfiles().find((p) => p.id === id);
  }

  getActiveProfile(): ProviderProfile | undefined {
    const selectedId = this.storageDelegate.getSelectedProfileId();
    if (!selectedId) {
      return undefined;
    }
    return this.getProfile(selectedId);
  }

  async createProfile(
    input: CreateProviderProfileInput,
  ): Promise<ProviderProfile> {
    const id = (input.id || '').trim();
    validateProfileId(id);

    if (this.getProfile(id)) {
      throw new Error(`Profile with ID "${id}" already exists.`);
    }

    let defaultModels: ProviderModel[] = [];
    let defaultModel = input.defaultModel;

    if (input.models && input.models.length > 0) {
      defaultModels = [...input.models];
      if (!defaultModel) {
        defaultModel = defaultModels[0].id;
      }
    } else {
      if (input.providerType === ProviderType.USE_GEMINI) {
        defaultModels = [
          {
            id: DEFAULT_GEMINI_FLASH_MODEL,
            tier: 'flash',
          },
          {
            id: DEFAULT_GEMINI_MODEL,
            tier: 'pro',
          },
        ];
        defaultModel = defaultModel || DEFAULT_GEMINI_FLASH_MODEL;
      } else {
        defaultModels = [
          {
            id: 'gpt-4o',
            tier: 'pro',
          },
          {
            id: 'gpt-4o-mini',
            tier: 'flash',
          },
        ];
        defaultModel = defaultModel || 'gpt-4o';
      }
    }

    const profile: ProviderProfile = {
      id,
      providerType: input.providerType,
      baseUrl: input.baseUrl,
      customHeaders: input.customHeaders,
      models: defaultModels,
      defaultModel,
    };

    const currentProfiles = this.listProfiles();
    const updatedProfiles = [...currentProfiles, profile];
    const currentSelectedId = this.storageDelegate.getSelectedProfileId();

    await this.storageDelegate.saveProfiles(
      updatedProfiles,
      currentSelectedId || profile.id,
    );

    return profile;
  }

  async updateProfile(
    id: ProviderProfileId,
    patch: UpdateProviderProfileInput,
  ): Promise<void> {
    const profiles = this.listProfiles();
    const index = profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new Error(`Profile with ID "${id}" not found.`);
    }

    const existing = profiles[index];
    let targetId = existing.id;

    if (patch.id !== undefined) {
      const trimmedNewId = patch.id.trim();
      validateProfileId(trimmedNewId);

      if (trimmedNewId !== id) {
        if (this.getProfile(trimmedNewId)) {
          throw new Error(`Profile with ID "${trimmedNewId}" already exists.`);
        }

        // Migrate API key in Keychain
        const oldApiKey = await loadApiKeyForProfile(id);
        if (oldApiKey) {
          await saveApiKeyForProfile(trimmedNewId, oldApiKey);
          await clearApiKeyForProfile(id);
        }

        targetId = trimmedNewId;
      }
    }

    const updated: ProviderProfile = {
      ...existing,
      id: targetId,
      providerType:
        patch.providerType !== undefined
          ? patch.providerType
          : existing.providerType,
      baseUrl: patch.baseUrl !== undefined ? patch.baseUrl : existing.baseUrl,
      customHeaders:
        patch.customHeaders !== undefined
          ? patch.customHeaders
          : existing.customHeaders,
      models: patch.models !== undefined ? [...patch.models] : existing.models,
      defaultModel:
        patch.defaultModel !== undefined
          ? patch.defaultModel
          : existing.defaultModel,
    };

    profiles[index] = updated;
    let selectedId = this.storageDelegate.getSelectedProfileId();
    if (selectedId === id && targetId !== id) {
      selectedId = targetId;
    }
    await this.storageDelegate.saveProfiles(profiles, selectedId);
    if (selectedId === targetId) {
      this.config.modelConfigService?.applyProfile(updated);
    }
  }

  async deleteProfile(id: ProviderProfileId): Promise<void> {
    const profiles = this.listProfiles();
    const index = profiles.findIndex((p) => p.id === id);
    if (index === -1) {
      throw new Error(`Profile with ID "${id}" not found.`);
    }

    // Attempt to clear credentials from storage first
    try {
      await clearApiKeyForProfile(id);
    } catch {
      // ignore failure
    }

    const remaining = profiles.filter((p) => p.id !== id);
    const selectedId = this.storageDelegate.getSelectedProfileId();

    if (selectedId === id) {
      if (remaining.length > 0) {
        await this.storageDelegate.saveProfiles(remaining, remaining[0].id);
        await this.activateProfile(remaining[0].id);
      } else {
        await this.storageDelegate.saveProfiles(remaining, undefined);
        this.config.modelConfigService?.applyProfile(undefined);
      }
    } else {
      await this.storageDelegate.saveProfiles(remaining, selectedId);
    }
  }

  async activateProfile(id: ProviderProfileId): Promise<void> {
    const targetProfile = this.getProfile(id);
    if (!targetProfile) {
      throw new Error(`Profile with ID "${id}" not found.`);
    }

    // Check environment variable mismatch
    const geminiEnvKey = this.env['GEMINI_API_KEY'];
    const openAiEnvKey = this.env['OPENAI_API_KEY'];

    // Resolve API key
    // Priority: Environment Variable > Keychain > none
    let resolvedApiKey: string | undefined = undefined;

    if (targetProfile.providerType === ProviderType.USE_GEMINI) {
      resolvedApiKey =
        geminiEnvKey ||
        (await loadApiKeyForProfile(targetProfile.id)) ||
        undefined;
    } else if (targetProfile.providerType === ProviderType.USE_OPENAI) {
      resolvedApiKey =
        openAiEnvKey ||
        (await loadApiKeyForProfile(targetProfile.id)) ||
        undefined;
    }

    if (!resolvedApiKey && !targetProfile.baseUrl) {
      if (
        targetProfile.providerType === ProviderType.USE_GEMINI &&
        openAiEnvKey &&
        !geminiEnvKey
      ) {
        throw new Error(
          'The active provider type is Gemini, but OPENAI_API_KEY was detected in environment variables. Please switch to an OpenAI provider or unset OPENAI_API_KEY.',
        );
      }
      if (
        targetProfile.providerType === ProviderType.USE_OPENAI &&
        geminiEnvKey &&
        !openAiEnvKey
      ) {
        throw new Error(
          'The active provider type is OpenAI, but GEMINI_API_KEY was detected in environment variables. Please switch to a Gemini provider or unset GEMINI_API_KEY.',
        );
      }
    }

    // Validate base URL if present
    if (targetProfile.baseUrl) {
      try {
        new URL(targetProfile.baseUrl);
      } catch {
        throw new Error(`Invalid custom base URL: ${targetProfile.baseUrl}`);
      }
    }

    // Perform refreshAuth (transactional: if it fails, exception is thrown before modifying selectedProviderId)
    await this.config.refreshAuth(
      targetProfile.providerType,
      resolvedApiKey,
      targetProfile.baseUrl,
      targetProfile.customHeaders,
    );

    // Resolve model for target profile
    const currentModel = this.config.getModel();
    const modelExistsInProfile = targetProfile.models.some(
      (m) => m.id === currentModel || m.tier === currentModel,
    );

    let chosenModel: string;
    if (modelExistsInProfile) {
      chosenModel = currentModel;
    } else if (targetProfile.defaultModel) {
      chosenModel = targetProfile.defaultModel;
    } else if (targetProfile.models.length > 0) {
      chosenModel = targetProfile.models[0].id;
    } else {
      chosenModel =
        targetProfile.providerType === ProviderType.USE_GEMINI
          ? DEFAULT_GEMINI_MODEL
          : 'gpt-4o';
    }

    this.config.modelConfigService?.applyProfile(targetProfile);
    this.config.setModel(chosenModel, true);

    // Update selectedProviderId in storage
    await this.storageDelegate.saveProfiles(
      this.listProfiles(),
      targetProfile.id,
    );

    // Notify UI / listeners
    coreEvents.emitModelChanged(chosenModel);
  }

  async addModel(
    profileId: ProviderProfileId,
    model: ProviderModel,
  ): Promise<void> {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Profile with ID "${profileId}" not found.`);
    }

    let models = profile.models;
    // If the added model specifies a tier, remove that tier from any existing model in this profile
    if (model.tier) {
      models = models.map((m) =>
        m.tier === model.tier && m.id !== model.id
          ? { ...m, tier: undefined }
          : m,
      );
    }

    const existingIndex = models.findIndex((m) => m.id === model.id);
    let updatedModels: ProviderModel[];
    if (existingIndex >= 0) {
      updatedModels = [...models];
      updatedModels[existingIndex] = model;
    } else {
      updatedModels = [...models, model];
    }

    const defaultModel = profile.defaultModel || model.id;
    await this.updateProfile(profileId, {
      models: updatedModels,
      defaultModel,
    });
  }

  async removeModel(
    profileId: ProviderProfileId,
    modelId: string,
  ): Promise<void> {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Profile with ID "${profileId}" not found.`);
    }

    const updatedModels = profile.models.filter((m) => m.id !== modelId);
    let defaultModel = profile.defaultModel;
    if (defaultModel === modelId) {
      defaultModel = updatedModels[0]?.id;
    }

    await this.updateProfile(profileId, {
      models: updatedModels,
      defaultModel,
    });
  }

  async setDefaultModel(
    profileId: ProviderProfileId,
    modelId: string,
  ): Promise<void> {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Profile with ID "${profileId}" not found.`);
    }

    await this.updateProfile(profileId, {
      defaultModel: modelId,
    });

    const activeProfile = this.getActiveProfile();
    if (activeProfile?.id === profileId) {
      this.config.setModel(modelId, false);
    }
  }

  async updateModel(
    profileId: ProviderProfileId,
    modelId: string,
    patch: Partial<ProviderModel>,
  ): Promise<void> {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error(`Profile with ID "${profileId}" not found.`);
    }

    if (patch.id && patch.id !== modelId) {
      const duplicate = profile.models.some((m) => m.id === patch.id);
      if (duplicate) {
        throw new Error(`Model with ID "${patch.id}" already exists.`);
      }
    }

    let models = profile.models;
    // If the patch specifies a tier, remove that tier from any other model in this profile
    if (patch.tier) {
      models = models.map((m) =>
        m.tier === patch.tier && m.id !== modelId
          ? { ...m, tier: undefined }
          : m,
      );
    }

    const updatedModels = models.map((m) => {
      if (m.id === modelId) {
        return {
          ...m,
          ...patch,
          id: patch.id || m.id,
        };
      }
      return m;
    });

    let defaultModel = profile.defaultModel;
    if (defaultModel === modelId && patch.id && patch.id !== modelId) {
      defaultModel = patch.id;
    }

    await this.updateProfile(profileId, {
      models: updatedModels,
      defaultModel,
    });
  }
}
