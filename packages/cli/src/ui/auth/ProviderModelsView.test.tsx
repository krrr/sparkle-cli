/**
 * @license
 * Copyright 2026 krrr
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { act } from 'react';
import { ProviderModelsView } from './ProviderModelsView.js';
import {
  DEFAULT_OPENAI_MODEL,
  ProviderType,
  type ProviderProfile,
} from 'sparkle-cli-core';

const mockLoadApiKeyForProfile = vi.fn();
const mockListModels = vi.fn();

vi.mock('sparkle-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sparkle-cli-core')>();
  return {
    ...actual,
    loadApiKeyForProfile: (id: string) => mockLoadApiKeyForProfile(id),
    OpenAiCompatibleGenerator: class {
      listModels = mockListModels;
    },
  };
});

describe('ProviderModelsView', () => {
  const mockProfile: ProviderProfile = {
    id: 'test-profile',
    providerType: ProviderType.USE_OPENAI,
    models: [
      {
        id: DEFAULT_OPENAI_MODEL,
        tier: 'pro',
      },
    ],
    defaultModel: DEFAULT_OPENAI_MODEL,
  };

  const onAddModel = vi.fn();
  const onUpdateModel = vi.fn();
  const onDeleteModel = vi.fn();
  const onSetDefaultModel = vi.fn();
  const onBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OPENAI_API_KEY', '');
    mockLoadApiKeyForProfile.mockResolvedValue('stored-key');
    mockListModels.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders model list and shortcuts', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ProviderModelsView
        profile={mockProfile}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
        onSetDefaultModel={onSetDefaultModel}
        onBack={onBack}
      />,
    );

    expect(lastFrame()).toContain('Models for: test-profile');
    expect(lastFrame()).toContain(DEFAULT_OPENAI_MODEL);
    expect(lastFrame()).toContain('tier: pro');
    expect(lastFrame()).toContain('[a] Add model');
    expect(lastFrame()).toContain('[Esc] Back');
    unmount();
  });

  it('handles list shortcuts for back, default, and delete', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelsView
        profile={mockProfile}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
        onSetDefaultModel={onSetDefaultModel}
        onBack={onBack}
      />,
    );

    // Press 's' to set default
    await act(async () => {
      stdin.write('s');
    });
    await waitUntilReady();
    expect(onSetDefaultModel).toHaveBeenCalledWith(DEFAULT_OPENAI_MODEL);

    // First 'd' press: arm delete confirmation
    await act(async () => {
      stdin.write('d');
    });
    await waitUntilReady();
    expect(lastFrame()).toContain('[d] again to confirm');
    expect(onDeleteModel).not.toHaveBeenCalled();

    // Second 'd' press: confirm delete
    await act(async () => {
      stdin.write('d');
    });
    await waitUntilReady();
    expect(onDeleteModel).toHaveBeenCalledWith(DEFAULT_OPENAI_MODEL);

    // Press Esc to back
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();
    expect(onBack).toHaveBeenCalled();

    unmount();
  });

  it('cancels delete confirmation when pressing escape without closing view', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelsView
        profile={mockProfile}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
        onSetDefaultModel={onSetDefaultModel}
        onBack={onBack}
      />,
    );

    // Arm confirmation
    await act(async () => {
      stdin.write('d');
    });
    await waitUntilReady();
    expect(lastFrame()).toContain('[d] again to confirm');

    // Press Escape to cancel confirmation
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();
    expect(onDeleteModel).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('[d] Delete');
    expect(lastFrame()).not.toContain('again to confirm');

    unmount();
  });

  it('cancels delete confirmation when pressing other keys like navigation', async () => {
    const profileWithTwoModels: ProviderProfile = {
      ...mockProfile,
      models: [
        { id: DEFAULT_OPENAI_MODEL, tier: 'pro' },
        { id: 'gpt-4o-mini', tier: 'flash' },
      ],
    };

    const { lastFrame, stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelsView
        profile={profileWithTwoModels}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
        onSetDefaultModel={onSetDefaultModel}
        onBack={onBack}
      />,
    );

    // Arm confirmation
    await act(async () => {
      stdin.write('d');
    });
    await waitUntilReady();
    expect(lastFrame()).toContain('[d] again to confirm');

    // Press Arrow Down to navigate, cancelling confirmation
    await act(async () => {
      stdin.write('\u001b[B');
    });
    await waitUntilReady();
    expect(onDeleteModel).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('[d] Delete');
    expect(lastFrame()).not.toContain('again to confirm');

    unmount();
  });

  it('enters add model edit mode when pressing a', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelsView
        profile={mockProfile}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
        onSetDefaultModel={onSetDefaultModel}
        onBack={onBack}
      />,
    );

    // Press 'a' to enter add model mode
    await act(async () => {
      stdin.write('a');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(lastFrame()).toContain('Add Model');
      expect(lastFrame()).toContain('Model ID:');
      expect(lastFrame()).toContain('Model Tier:');
      expect(lastFrame()).toContain('Esc to save & return');
    });

    unmount();
  });

  it('enters edit mode for selected model when pressing e', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelsView
        profile={mockProfile}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
        onSetDefaultModel={onSetDefaultModel}
        onBack={onBack}
      />,
    );

    // Press 'e' to enter edit model mode
    await act(async () => {
      stdin.write('e');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(lastFrame()).toContain('Edit Model: gpt-4o');
      expect(lastFrame()).toContain('Model ID:');
      expect(lastFrame()).toContain('Model Tier:');
    });

    unmount();
  });

  it('saves added model from edit view and returns to list view', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelsView
        profile={mockProfile}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
        onSetDefaultModel={onSetDefaultModel}
        onBack={onBack}
      />,
    );

    // Press 'a' to enter add model mode
    await act(async () => {
      stdin.write('a');
    });
    await waitUntilReady();

    // Type model id
    await act(async () => {
      stdin.write('claude-3-5-sonnet');
    });
    await waitUntilReady();

    // Press Escape to save & return
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(onAddModel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'claude-3-5-sonnet',
        }),
      );
      expect(lastFrame()).toContain('Models for: test-profile');
    });

    unmount();
  });

  it('renders model names when configured, falling back to ids', async () => {
    const profileWithNames: ProviderProfile = {
      ...mockProfile,
      name: 'My Provider',
      models: [
        { id: DEFAULT_OPENAI_MODEL, name: 'GPT-4o', tier: 'pro' },
        { id: 'gpt-4o-mini', tier: 'flash' },
      ],
    };

    const { lastFrame, unmount } = await renderWithProviders(
      <ProviderModelsView
        profile={profileWithNames}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
        onSetDefaultModel={onSetDefaultModel}
        onBack={onBack}
      />,
    );

    expect(lastFrame()).toContain('Models for: My Provider');
    expect(lastFrame()).toContain('GPT-4o');
    // The raw id must not appear as a standalone model row label. The fallback
    // model below (gpt-4o-mini) contains the default id as a prefix, so use a
    // negative lookahead to assert the bare id is not rendered. Matching is
    // case-sensitive: the display name "GPT-4o" differs from the id "gpt-4o".
    expect(lastFrame()).not.toMatch(/gpt-4o(?!-mini)/);
    expect(lastFrame()).toContain('gpt-4o-mini');
    unmount();
  });

  it('renders empty state when no models are configured', async () => {
    const emptyProfile: ProviderProfile = {
      id: 'test-profile-empty',
      providerType: ProviderType.USE_OPENAI,
      models: [],
    };

    const { lastFrame, stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelsView
        profile={emptyProfile}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
        onSetDefaultModel={onSetDefaultModel}
        onBack={onBack}
      />,
    );

    expect(lastFrame()).toContain('No models configured for this provider.');
    expect(lastFrame()).toContain('[a] Add model');
    expect(lastFrame()).toContain('[Esc] Back');

    // Press Esc to back
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();
    expect(onBack).toHaveBeenCalled();

    unmount();
  });

  it('renders default indicator and no tier when model has no tier', async () => {
    const profileWithoutTier: ProviderProfile = {
      id: 'test-profile-no-tier',
      providerType: ProviderType.USE_GEMINI,
      models: [
        {
          id: 'gemini-2.5-flash',
        },
      ],
      defaultModel: 'gemini-2.5-flash',
    };

    const { lastFrame, unmount } = await renderWithProviders(
      <ProviderModelsView
        profile={profileWithoutTier}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
        onSetDefaultModel={onSetDefaultModel}
        onBack={onBack}
      />,
    );

    expect(lastFrame()).toContain('gemini-2.5-flash');
    expect(lastFrame()).toContain('✓ Default');
    expect(lastFrame()).toContain('no tier');
    unmount();
  });

  it('shows the List from API shortcut only for OpenAI profiles', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ProviderModelsView
        profile={mockProfile}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
        onSetDefaultModel={onSetDefaultModel}
        onBack={onBack}
      />,
    );

    expect(lastFrame()).toContain('[l] List from API');
    unmount();

    const geminiProfile: ProviderProfile = {
      id: 'test-profile-gemini',
      providerType: ProviderType.USE_GEMINI,
      models: [{ id: 'gemini-2.5-flash' }],
    };
    const {
      lastFrame: geminiFrame,
      stdin,
      waitUntilReady,
      unmount: unmountGemini,
    } = await renderWithProviders(
      <ProviderModelsView
        profile={geminiProfile}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
        onSetDefaultModel={onSetDefaultModel}
        onBack={onBack}
      />,
    );

    expect(geminiFrame()).not.toContain('[l] List from API');

    // Pressing 'l' on a Gemini profile must not enter the fetch view.
    await act(async () => {
      stdin.write('l');
    });
    await waitUntilReady();
    expect(geminiFrame()).toContain('Models for: test-profile-gemini');
    unmountGemini();
  });

  it('enters the fetch view on l and returns to the list on escape', async () => {
    mockListModels.mockResolvedValue(['remote-model-1', 'remote-model-2']);
    const { lastFrame, stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelsView
        profile={mockProfile}
        onAddModel={onAddModel}
        onUpdateModel={onUpdateModel}
        onDeleteModel={onDeleteModel}
        onSetDefaultModel={onSetDefaultModel}
        onBack={onBack}
      />,
    );

    await act(async () => {
      stdin.write('l');
    });
    await waitUntilReady();
    expect(lastFrame()).toContain('Models from API');

    // Esc returns to the model list view.
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();
    expect(lastFrame()).toContain('Models for: test-profile');
    expect(lastFrame()).toContain(DEFAULT_OPENAI_MODEL);
    unmount();
  });
});
