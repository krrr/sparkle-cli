/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { act } from 'react';
import { ProviderModelsView } from './ProviderModelsView.js';
import {
  DEFAULT_OPENAI_MODEL,
  ProviderType,
  type ProviderProfile,
} from 'sparkle-cli-core';

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
    const { stdin, waitUntilReady, unmount } = await renderWithProviders(
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

    // Press 'd' to delete
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

  it('enters add model edit mode when pressing a', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderWithProviders(
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
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderWithProviders(
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
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderWithProviders(
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

  it('renders empty state when no models are configured', async () => {
    const emptyProfile: ProviderProfile = {
      id: 'test-profile-empty',
      providerType: ProviderType.USE_OPENAI,
      models: [],
    };

    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderWithProviders(
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
});
