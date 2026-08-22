/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderProfileService } from './providerProfileService.js';
import { ProviderType } from '../config/constants.js';
import {
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_OPENAI_MODEL,
} from '../config/models.js';
import type { Config } from '../config/config.js';
import type { ProviderProfile } from '../config/providerProfile.js';

const loadApiKeyForProfileMock = vi.hoisted(() => vi.fn());
const saveApiKeyForProfileMock = vi.hoisted(() => vi.fn());
const clearApiKeyForProfileMock = vi.hoisted(() => vi.fn());

vi.mock('../core/apiKeyCredentialStorage.js', () => ({
  loadApiKeyForProfile: loadApiKeyForProfileMock,
  saveApiKeyForProfile: saveApiKeyForProfileMock,
  clearApiKeyForProfile: clearApiKeyForProfileMock,
}));

describe('ProviderProfileService', () => {
  let mockConfig: Config;
  let storedProfiles: ProviderProfile[];
  let storedSelectedId: string | undefined;
  let env: Record<string, string | undefined>;
  let service: ProviderProfileService;

  beforeEach(() => {
    vi.clearAllMocks();
    storedProfiles = [];
    storedSelectedId = undefined;
    env = {};

    mockConfig = {
      refreshAuth: vi.fn().mockResolvedValue(undefined),
      getModel: vi.fn().mockReturnValue(DEFAULT_GEMINI_FLASH_MODEL),
      setModel: vi.fn(),
      getApiKey: vi.fn().mockReturnValue(undefined),
      fakeResponses: false,
      fakeResponsesNonStrict: false,
    } as unknown as Config;

    service = new ProviderProfileService({
      config: mockConfig,
      storageDelegate: {
        getProfiles: () => storedProfiles,
        getSelectedProfileId: () => storedSelectedId,
        saveProfiles: (profiles, selectedId) => {
          storedProfiles = [...profiles];
          storedSelectedId = selectedId;
        },
      },
      env,
    });
  });

  describe('CRUD Operations', () => {
    it('should create a Gemini profile with default models', async () => {
      const profile = await service.createProfile({
        id: 'personal-gemini',
        providerType: ProviderType.USE_GEMINI,
      });

      expect(profile.id).toBe('personal-gemini');
      expect(profile.providerType).toBe(ProviderType.USE_GEMINI);
      expect(profile.models.length).toBe(2);
      expect(profile.defaultModel).toBe(DEFAULT_GEMINI_FLASH_MODEL);
      expect(storedProfiles).toHaveLength(1);
      expect(storedSelectedId).toBe(profile.id);
    });

    it('should create an OpenAI profile with custom models', async () => {
      const profile = await service.createProfile({
        id: 'work-openai',
        providerType: ProviderType.USE_OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        models: [{ id: DEFAULT_OPENAI_MODEL, tier: 'pro' }],
        defaultModel: DEFAULT_OPENAI_MODEL,
      });

      expect(profile.id).toBe('work-openai');
      expect(profile.baseUrl).toBe('https://api.openai.com/v1');
      expect(profile.models).toEqual([
        { id: DEFAULT_OPENAI_MODEL, tier: 'pro' },
      ]);
      expect(profile.defaultModel).toBe(DEFAULT_OPENAI_MODEL);
    });

    it('should reject invalid profile ID or empty ID', async () => {
      await expect(
        service.createProfile({
          id: '',
          providerType: ProviderType.USE_GEMINI,
        }),
      ).rejects.toThrow(/Provider profile ID is required/);

      await expect(
        service.createProfile({
          id: 'invalid id with spaces',
          providerType: ProviderType.USE_GEMINI,
        }),
      ).rejects.toThrow(/Invalid profile ID/);

      await expect(
        service.createProfile({
          id: 'invalid@name!',
          providerType: ProviderType.USE_GEMINI,
        }),
      ).rejects.toThrow(/Invalid profile ID/);
    });

    it('should allow valid profile ID with letters, numbers, underscores, and hyphens', async () => {
      const profile = await service.createProfile({
        id: 'custom_profile-123_abc',
        providerType: ProviderType.USE_GEMINI,
      });

      expect(profile.id).toBe('custom_profile-123_abc');
    });

    it('should reject duplicate profile ID', async () => {
      await service.createProfile({
        id: 'dup-id',
        providerType: ProviderType.USE_GEMINI,
      });

      await expect(
        service.createProfile({
          id: 'dup-id',
          providerType: ProviderType.USE_OPENAI,
        }),
      ).rejects.toThrow(/Profile with ID "dup-id" already exists/);
    });

    it('should update profile fields', async () => {
      const profile = await service.createProfile({
        id: 'profile-to-update',
        providerType: ProviderType.USE_GEMINI,
      });

      await service.updateProfile(profile.id, {
        baseUrl: 'https://custom.endpoint',
      });

      const updated = service.getProfile(profile.id);
      expect(updated?.id).toBe('profile-to-update');
      expect(updated?.baseUrl).toBe('https://custom.endpoint');
    });

    it('should update profile ID, migrate keychain credentials, and update selectedProfileId', async () => {
      await service.createProfile({
        id: 'old-id',
        providerType: ProviderType.USE_GEMINI,
      });
      storedSelectedId = 'old-id';
      loadApiKeyForProfileMock.mockResolvedValueOnce('sk-secret-key');

      await service.updateProfile('old-id', {
        id: 'new-id',
        baseUrl: 'https://new.endpoint',
      });

      expect(service.getProfile('old-id')).toBeUndefined();
      const updated = service.getProfile('new-id');
      expect(updated).toBeDefined();
      expect(updated?.id).toBe('new-id');
      expect(updated?.baseUrl).toBe('https://new.endpoint');
      expect(storedSelectedId).toBe('new-id');

      expect(loadApiKeyForProfileMock).toHaveBeenCalledWith('old-id');
      expect(saveApiKeyForProfileMock).toHaveBeenCalledWith(
        'new-id',
        'sk-secret-key',
      );
      expect(clearApiKeyForProfileMock).toHaveBeenCalledWith('old-id');
    });

    it('should reject updating to an invalid ID format', async () => {
      await service.createProfile({
        id: 'valid-id',
        providerType: ProviderType.USE_GEMINI,
      });

      await expect(
        service.updateProfile('valid-id', {
          id: 'invalid id with spaces',
        }),
      ).rejects.toThrow(/Invalid profile ID/);
    });

    it('should reject updating to an existing profile ID', async () => {
      await service.createProfile({
        id: 'prof-a',
        providerType: ProviderType.USE_GEMINI,
      });
      await service.createProfile({
        id: 'prof-b',
        providerType: ProviderType.USE_OPENAI,
      });

      await expect(
        service.updateProfile('prof-a', {
          id: 'prof-b',
        }),
      ).rejects.toThrow(/Profile with ID "prof-b" already exists/);
    });

    it('should add, update, remove and setDefaultModel for profile', async () => {
      const profile = await service.createProfile({
        id: 'openai-test',
        providerType: ProviderType.USE_OPENAI,
      });

      await service.addModel(profile.id, {
        id: 'o1-preview',
      });

      let updated = service.getProfile(profile.id);
      expect(updated?.models.some((m) => m.id === 'o1-preview')).toBe(true);

      await service.setDefaultModel(profile.id, 'o1-preview');
      updated = service.getProfile(profile.id);
      expect(updated?.defaultModel).toBe('o1-preview');

      await service.updateModel(profile.id, 'o1-preview', {
        tier: 'pro',
      });
      updated = service.getProfile(profile.id);
      expect(updated?.models.find((m) => m.id === 'o1-preview')?.tier).toBe(
        'pro',
      );

      await service.removeModel(profile.id, 'o1-preview');
      updated = service.getProfile(profile.id);
      expect(updated?.models.some((m) => m.id === 'o1-preview')).toBe(false);
      expect(updated?.defaultModel).not.toBe('o1-preview');
    });

    it('should delete a profile and clear credentials', async () => {
      const p1 = await service.createProfile({
        id: 'p1',
        providerType: ProviderType.USE_GEMINI,
      });
      const p2 = await service.createProfile({
        id: 'p2',
        providerType: ProviderType.USE_OPENAI,
      });

      storedSelectedId = p1.id;
      await service.deleteProfile(p1.id);

      expect(clearApiKeyForProfileMock).toHaveBeenCalledWith(p1.id);
      expect(service.listProfiles()).toHaveLength(1);
      expect(service.getActiveProfile()?.id).toBe(p2.id);
    });

    it('should set active profile to undefined when last profile deleted', async () => {
      const p1 = await service.createProfile({
        id: 'p1',
        providerType: ProviderType.USE_GEMINI,
      });
      storedSelectedId = p1.id;

      await service.deleteProfile(p1.id);
      expect(service.listProfiles()).toHaveLength(0);
      expect(service.getActiveProfile()).toBeUndefined();
    });
  });

  describe('activateProfile', () => {
    it('should throw error when profile not found', async () => {
      await expect(service.activateProfile('nonexistent')).rejects.toThrow(
        /not found/,
      );
    });

    it('should reject when active provider is Gemini but OPENAI_API_KEY is present without GEMINI_API_KEY', async () => {
      const p = await service.createProfile({
        id: 'gemini-profile',
        providerType: ProviderType.USE_GEMINI,
      });

      env['OPENAI_API_KEY'] = 'sk-something';
      delete env['GEMINI_API_KEY'];

      await expect(service.activateProfile(p.id)).rejects.toThrow(
        /active provider type is Gemini, but OPENAI_API_KEY was detected/,
      );
    });

    it('should reject when active provider is OpenAI but GEMINI_API_KEY is present without OPENAI_API_KEY', async () => {
      const p = await service.createProfile({
        id: 'openai-profile',
        providerType: ProviderType.USE_OPENAI,
      });

      env['GEMINI_API_KEY'] = 'gemini-something';
      delete env['OPENAI_API_KEY'];

      await expect(service.activateProfile(p.id)).rejects.toThrow(
        /active provider type is OpenAI, but GEMINI_API_KEY was detected/,
      );
    });

    it('should resolve API key with priority: env var > keychain', async () => {
      const p = await service.createProfile({
        id: 'gemini-test',
        providerType: ProviderType.USE_GEMINI,
      });

      loadApiKeyForProfileMock.mockResolvedValue('keychain-key');
      env['GEMINI_API_KEY'] = 'env-key';

      await service.activateProfile(p.id);
      expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
        ProviderType.USE_GEMINI,
        'env-key',
        undefined,
        undefined,
      );

      // Now without env key
      delete env['GEMINI_API_KEY'];
      await service.activateProfile(p.id);
      expect(mockConfig.refreshAuth).toHaveBeenCalledWith(
        ProviderType.USE_GEMINI,
        'keychain-key',
        undefined,
        undefined,
      );
    });

    it('should validate base URL when present', async () => {
      const p = await service.createProfile({
        id: 'custom-openai',
        providerType: ProviderType.USE_OPENAI,
        baseUrl: 'invalid-url',
      });

      await expect(service.activateProfile(p.id)).rejects.toThrow(
        /Invalid custom base URL/,
      );
    });

    it('should rollback transaction if refreshAuth fails', async () => {
      const p1 = await service.createProfile({
        id: 'p1',
        providerType: ProviderType.USE_GEMINI,
      });
      const p2 = await service.createProfile({
        id: 'p2',
        providerType: ProviderType.USE_OPENAI,
      });

      storedSelectedId = p1.id;
      (
        mockConfig.refreshAuth as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error('Network error'));

      await expect(service.activateProfile(p2.id)).rejects.toThrow(
        'Network error',
      );
      expect(storedSelectedId).toBe(p1.id); // Not changed!
    });

    it('should retain model if present in target profile models, else switch to default', async () => {
      const p = await service.createProfile({
        id: 'openai-models',
        providerType: ProviderType.USE_OPENAI,
        models: [
          { id: DEFAULT_OPENAI_MODEL, tier: 'pro' },
          { id: 'gpt-4o-mini', tier: 'flash' },
        ],

        defaultModel: DEFAULT_OPENAI_MODEL,
      });

      (mockConfig.getModel as ReturnType<typeof vi.fn>).mockReturnValue(
        'gpt-4o-mini',
      );
      await service.activateProfile(p.id);
      expect(mockConfig.setModel).toHaveBeenCalledWith('gpt-4o-mini', true);

      (mockConfig.getModel as ReturnType<typeof vi.fn>).mockReturnValue(
        'unknown-model',
      );
      await service.activateProfile(p.id);
      expect(mockConfig.setModel).toHaveBeenCalledWith(
        DEFAULT_OPENAI_MODEL,
        true,
      );
    });
  });
});
