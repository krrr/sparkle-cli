/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initializeApp } from './initializer.js';
import {
  IdeClient,
  logIdeConnection,
  logCliConfiguration,
  ValidationRequiredError,
  ProviderType,
  type Config,
  type ProviderProfile,
} from 'sparkle-cli-core';
import { validateTheme } from './theme.js';
import { type LoadedSettings } from '../config/settings.js';

vi.mock('sparkle-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sparkle-cli-core')>();
  return {
    ...actual,
    IdeClient: {
      getInstance: vi.fn(),
    },
    logIdeConnection: vi.fn(),
    logCliConfiguration: vi.fn(),
    StartSessionEvent: vi.fn(),
    IdeConnectionEvent: vi.fn(),
  };
});

vi.mock('./theme.js', () => ({
  validateTheme: vi.fn(),
}));

describe('initializer', () => {
  let mockProfileService: {
    getActiveProfile: ReturnType<typeof vi.fn>;
    activateProfile: ReturnType<typeof vi.fn>;
  };
  let mockConfig: {
    getToolRegistry: ReturnType<typeof vi.fn>;
    getIdeMode: ReturnType<typeof vi.fn>;
    getGeminiMdFileCount: ReturnType<typeof vi.fn>;
    getProviderProfileService: ReturnType<typeof vi.fn>;
  };
  let mockSettings: LoadedSettings;
  let mockIdeClient: {
    connect: ReturnType<typeof vi.fn>;
  };
  const fakeProfile: ProviderProfile = {
    id: 'test-profile-1',
    providerType: ProviderType.USE_GEMINI,
    models: [{ id: 'gemini-2.5-flash' }],
    defaultModel: 'gemini-2.5-flash',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileService = {
      getActiveProfile: vi.fn().mockReturnValue(fakeProfile),
      activateProfile: vi.fn().mockResolvedValue(undefined),
    };
    mockConfig = {
      getToolRegistry: vi.fn(),
      getIdeMode: vi.fn().mockReturnValue(false),
      getGeminiMdFileCount: vi.fn().mockReturnValue(5),
      getProviderProfileService: vi.fn().mockReturnValue(mockProfileService),
    };
    mockSettings = {
      merged: {
        security: {
          auth: {
            selectedProviderId: fakeProfile.id,
            providers: [fakeProfile],
          },
        },
      },
    } as unknown as LoadedSettings;
    mockIdeClient = {
      connect: vi.fn(),
    };
    vi.mocked(IdeClient.getInstance).mockResolvedValue(
      mockIdeClient as unknown as IdeClient,
    );
    vi.mocked(validateTheme).mockReturnValue(null);
  });

  it('should initialize correctly in non-IDE mode', async () => {
    const result = await initializeApp(
      mockConfig as unknown as Config,
      mockSettings,
    );

    expect(result).toEqual({
      authError: null,
      themeError: null,
      shouldOpenAuthDialog: false,
      geminiMdFileCount: 5,
    });
    expect(mockProfileService.activateProfile).toHaveBeenCalledWith(
      fakeProfile.id,
    );
    expect(validateTheme).toHaveBeenCalledWith(mockSettings);
    expect(logCliConfiguration).toHaveBeenCalled();
    expect(IdeClient.getInstance).not.toHaveBeenCalled();
  });

  it('should initialize correctly in IDE mode', async () => {
    mockConfig.getIdeMode.mockReturnValue(true);
    const result = await initializeApp(
      mockConfig as unknown as Config,
      mockSettings,
    );

    // Wait for the background promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result).toEqual({
      authError: null,
      themeError: null,
      shouldOpenAuthDialog: false,
      geminiMdFileCount: 5,
    });
    expect(IdeClient.getInstance).toHaveBeenCalled();
    expect(mockIdeClient.connect).toHaveBeenCalled();
    expect(logIdeConnection).toHaveBeenCalledWith(
      mockConfig as unknown as Config,
      expect.any(Object),
    );
  });

  it('should handle auth error', async () => {
    mockProfileService.activateProfile.mockRejectedValue(
      new Error('Auth failed'),
    );
    const result = await initializeApp(
      mockConfig as unknown as Config,
      mockSettings,
    );

    expect(result.authError).toBe(
      'Failed to set LLM provider. Message: Auth failed',
    );
    expect(result.shouldOpenAuthDialog).toBe(true);
  });

  it('should treat ValidationRequiredError as non-fatal', async () => {
    mockProfileService.activateProfile.mockRejectedValue(
      new ValidationRequiredError('Validation required'),
    );
    const result = await initializeApp(
      mockConfig as unknown as Config,
      mockSettings,
    );

    expect(result.authError).toBeNull();
    expect(result.shouldOpenAuthDialog).toBe(false);
  });

  it('should handle undefined active profile', async () => {
    mockProfileService.getActiveProfile.mockReturnValue(undefined);
    const result = await initializeApp(
      mockConfig as unknown as Config,
      mockSettings,
    );

    expect(result.authError).toBeNull();
    expect(result.shouldOpenAuthDialog).toBe(true);
    expect(mockProfileService.activateProfile).not.toHaveBeenCalled();
  });
});
