/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import {
  ProviderType,
  type ProviderProfile,
  type Config,
  makeFakeConfig,
} from 'sparkle-cli-core';
import { ProviderManagerDialog } from './ProviderManagerDialog.js';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';

describe('Multi-Provider CLI components logic', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('verifies provider profiles data structure', () => {
    const profile: ProviderProfile = {
      id: 'test-profile-1',
      providerType: ProviderType.USE_GEMINI,
      models: [
        {
          id: 'gemini-2.5-flash',
          tier: 'flash',
        },
      ],
      defaultModel: 'gemini-2.5-flash',
    };

    expect(profile.id).toBe('test-profile-1');
    expect(profile.providerType).toBe(ProviderType.USE_GEMINI);
    expect(profile.models).toHaveLength(1);
    expect(profile.models[0].tier).toBe('flash');
  });

  it('handles model addition with only ID provided', () => {
    const profile: ProviderProfile = {
      id: 'test-profile-2',
      providerType: ProviderType.USE_OPENAI,
      baseUrl: 'https://api.openai.com/v1',
      models: [],
    };

    // User only specifies ID, omitting displayName and aliases
    const newModel = { id: 'gpt-4o' };
    profile.models.push(newModel);
    profile.defaultModel = newModel.id;

    expect(profile.models).toHaveLength(1);
    expect(profile.models[0].id).toBe('gpt-4o');
    expect(profile.defaultModel).toBe('gpt-4o');
  });
});

describe('ProviderManagerDialog', () => {
  let mockProfiles: ProviderProfile[];
  let activeProfileId: string | undefined;
  let mockProfileService: {
    listProfiles: ReturnType<typeof vi.fn>;
    getActiveProfile: ReturnType<typeof vi.fn>;
    getProfile: ReturnType<typeof vi.fn>;
    createProfile: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
    deleteProfile: ReturnType<typeof vi.fn>;
    activateProfile: ReturnType<typeof vi.fn>;
  };
  let mockConfig: Config;

  const setAuthState = vi.fn();
  const onAuthError = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();

    mockProfiles = [
      {
        id: 'default-gemini',
        providerType: ProviderType.USE_GEMINI,
        defaultModel: 'gemini-2.5-flash',
        models: [{ id: 'gemini-2.5-flash' }],
      },
    ];
    activeProfileId = 'default-gemini';

    mockProfileService = {
      listProfiles: vi.fn().mockImplementation(() => [...mockProfiles]),
      getActiveProfile: vi
        .fn()
        .mockImplementation(() =>
          mockProfiles.find((p) => p.id === activeProfileId),
        ),
      getProfile: vi
        .fn()
        .mockImplementation((id: string) =>
          mockProfiles.find((p) => p.id === id),
        ),
      createProfile: vi.fn().mockImplementation(async (data) => {
        const newProfile: ProviderProfile = {
          id: data.id,
          providerType: data.providerType,
          baseUrl: data.baseUrl,
          defaultModel: 'gpt-4o',
          models: [{ id: 'gpt-4o' }],
        };
        mockProfiles.push(newProfile);
        return newProfile;
      }),
      updateProfile: vi.fn().mockImplementation(async (id, patch) => {
        const idx = mockProfiles.findIndex((p) => p.id === id);
        if (idx !== -1) {
          const targetId = patch.id || id;
          mockProfiles[idx] = { ...mockProfiles[idx], ...patch, id: targetId };
          if (activeProfileId === id && patch.id) {
            activeProfileId = patch.id;
          }
        }
      }),
      deleteProfile: vi.fn().mockImplementation(async (id) => {
        mockProfiles = mockProfiles.filter((p) => p.id !== id);
        if (activeProfileId === id) {
          activeProfileId = mockProfiles[0]?.id;
        }
      }),
      activateProfile: vi.fn().mockImplementation(async (id) => {
        activeProfileId = id;
      }),
    };

    mockConfig = makeFakeConfig();
    vi.spyOn(mockConfig, 'getProviderProfileService').mockReturnValue(
      mockProfileService as unknown as ReturnType<
        Config['getProviderProfileService']
      >,
    );
  });

  it('renders provider list from state and refreshes upon adding a new provider', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderWithProviders(
        <ProviderManagerDialog
          setAuthState={setAuthState}
          authError={null}
          onAuthError={onAuthError}
        />,
        { config: mockConfig },
      );

    expect(lastFrame()).toContain('default-gemini');
    expect(lastFrame()).toContain('Provider Manager');

    // Press 'a' to enter Add Provider view
    await act(async () => {
      stdin.write('a');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(lastFrame()).toContain('Add New Provider');
      expect(lastFrame()).toContain('Provider ID:');
    });

    // Type provider ID
    await act(async () => {
      stdin.write('gemini-custom');
    });
    await waitUntilReady();

    // Press Escape to save; should jump straight into the model management
    // view for the newly created provider
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(lastFrame()).toContain('Models for: gemini-custom');
      expect(lastFrame()).toContain('gpt-4o');
    });
    // An active profile already exists, so no activation should occur
    expect(mockProfileService.activateProfile).not.toHaveBeenCalled();
    expect(setAuthState).not.toHaveBeenCalled();

    unmount();
  });

  it('returns to the provider list when leaving the models view of a new provider', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderWithProviders(
        <ProviderManagerDialog
          setAuthState={setAuthState}
          authError={null}
          onAuthError={onAuthError}
        />,
        { config: mockConfig },
      );

    expect(lastFrame()).toContain('Provider Manager');

    // Press 'a' to enter Add Provider view
    await act(async () => {
      stdin.write('a');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(lastFrame()).toContain('Add New Provider');
    });

    // Type provider ID
    await act(async () => {
      stdin.write('gemini-custom');
    });
    await waitUntilReady();

    // Save via Escape and land in the models view
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(lastFrame()).toContain('Models for: gemini-custom');
    });

    // Escape from the models view goes back to the provider list
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(lastFrame()).toContain('default-gemini');
      expect(lastFrame()).toContain('gemini-custom');
    });

    unmount();
  });

  it('activates and jumps to model management when creating the first provider', async () => {
    mockProfiles = [];
    activeProfileId = undefined;

    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderWithProviders(
        <ProviderManagerDialog
          setAuthState={setAuthState}
          authError={null}
          onAuthError={onAuthError}
        />,
        { config: mockConfig },
      );

    expect(lastFrame()).toContain('No providers configured.');

    // Press Enter to open Add Provider view
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(lastFrame()).toContain('Add New Provider');
    });

    // Type provider ID
    await act(async () => {
      stdin.write('gemini-first');
    });
    await waitUntilReady();

    // Save via Escape
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();

    // First provider is auto-activated without closing the dialog, which
    // then lands in the model management view
    await waitFor(() => {
      expect(mockProfileService.activateProfile).toHaveBeenCalledWith(
        'gemini-first',
      );
      expect(lastFrame()).toContain('Models for: gemini-first');
    });
    expect(setAuthState).not.toHaveBeenCalled();

    unmount();
  });

  it('allows editing and renaming an existing provider', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderWithProviders(
        <ProviderManagerDialog
          setAuthState={setAuthState}
          authError={null}
          onAuthError={onAuthError}
        />,
        { config: mockConfig },
      );

    expect(lastFrame()).toContain('default-gemini');

    // Press 'e' to enter edit mode
    await act(async () => {
      stdin.write('e');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(lastFrame()).toContain('Edit Provider: default-gemini');
      expect(lastFrame()).toContain('Provider ID:');
    });

    // Append to ID
    await act(async () => {
      stdin.write('-renamed');
    });
    await waitUntilReady();

    // Press Escape to save and return
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(mockProfileService.updateProfile).toHaveBeenCalledWith(
        'default-gemini',
        expect.objectContaining({
          id: 'default-gemini-renamed',
        }),
      );
      expect(lastFrame()).toContain('default-gemini-renamed');
    });

    unmount();
  });

  it('refreshes the list in state after deleting a provider', async () => {
    mockProfiles.push({
      id: 'p2',
      providerType: ProviderType.USE_OPENAI,
      defaultModel: 'gpt-4o',
      models: [{ id: 'gpt-4o' }],
    });

    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderWithProviders(
        <ProviderManagerDialog
          setAuthState={setAuthState}
          authError={null}
          onAuthError={onAuthError}
        />,
        { config: mockConfig },
      );

    // First press 'd' to enter delete confirmation
    await act(async () => {
      stdin.write('d');
    });
    await waitUntilReady();

    expect(lastFrame()).toContain('again to confirm');
    expect(mockProfileService.deleteProfile).not.toHaveBeenCalled();

    // Second press 'd' to confirm delete
    await act(async () => {
      stdin.write('d');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(mockProfileService.deleteProfile).toHaveBeenCalledWith(
        'default-gemini',
      );
      expect(lastFrame()).not.toContain('default-gemini');
      expect(lastFrame()).toContain('p2');
    });

    unmount();
  });
});
