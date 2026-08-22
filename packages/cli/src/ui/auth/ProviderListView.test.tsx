/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { act } from 'react';
import { ProviderListView } from './ProviderListView.js';
import {
  DEFAULT_OPENAI_MODEL,
  ProviderType,
  type ProviderProfile,
} from 'sparkle-cli-core';

describe('ProviderListView', () => {
  const mockProfiles: ProviderProfile[] = [
    {
      id: 'profile-1',
      providerType: ProviderType.USE_GEMINI,
      defaultModel: 'gemini-2.5-flash',
      models: [{ id: 'gemini-2.5-flash' }],
    },
    {
      id: 'profile-2',
      providerType: ProviderType.USE_OPENAI,
      baseUrl: 'https://api.openai.com/v1',
      defaultModel: DEFAULT_OPENAI_MODEL,
      models: [{ id: DEFAULT_OPENAI_MODEL }],
    },
  ];

  const onActivate = vi.fn();
  const onAdd = vi.fn();
  const onEdit = vi.fn();
  const onManageModels = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty message when no profiles configured', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderWithProviders(
        <ProviderListView
          profiles={[]}
          onActivate={onActivate}
          onAdd={onAdd}
          onEdit={onEdit}
          onManageModels={onManageModels}
          onDelete={onDelete}
          onClose={onClose}
        />,
      );

    expect(lastFrame()).toContain('No providers configured.');
    expect(lastFrame()).toContain('[Enter] Add provider');

    // Press Enter to add
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();
    expect(onAdd).toHaveBeenCalledTimes(1);

    // Press Escape to close
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('renders provider list and default shortcuts', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ProviderListView
        profiles={mockProfiles}
        activeProfileId="profile-1"
        onActivate={onActivate}
        onAdd={onAdd}
        onEdit={onEdit}
        onManageModels={onManageModels}
        onDelete={onDelete}
        onClose={onClose}
      />,
    );

    expect(lastFrame()).toContain('Provider Manager');
    expect(lastFrame()).toContain('profile-1');
    expect(lastFrame()).toContain('profile-2');
    expect(lastFrame()).toContain('[a] Add');
    expect(lastFrame()).toContain('[e] Edit');
    expect(lastFrame()).toContain('[m] Models');
    expect(lastFrame()).toContain('[d] Delete');
    expect(lastFrame()).toContain('[Enter] Activate');
    expect(lastFrame()).toContain('[Esc] Close');

    unmount();
  });

  it('arms delete confirmation on first d press and deletes on second d press', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderWithProviders(
        <ProviderListView
          profiles={mockProfiles}
          activeProfileId="profile-1"
          onActivate={onActivate}
          onAdd={onAdd}
          onEdit={onEdit}
          onManageModels={onManageModels}
          onDelete={onDelete}
          onClose={onClose}
        />,
      );

    // First 'd' press: arm confirmation
    await act(async () => {
      stdin.write('d');
    });
    await waitUntilReady();

    expect(lastFrame()).toContain('[d] again to confirm');
    expect(lastFrame()).toContain('[Esc] Cancel');
    expect(onDelete).not.toHaveBeenCalled();

    // Second 'd' press: confirm delete
    await act(async () => {
      stdin.write('d');
    });
    await waitUntilReady();

    expect(onDelete).toHaveBeenCalledWith(mockProfiles[0]);

    unmount();
  });

  it('cancels delete confirmation when pressing escape without closing view', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderWithProviders(
        <ProviderListView
          profiles={mockProfiles}
          activeProfileId="profile-1"
          onActivate={onActivate}
          onAdd={onAdd}
          onEdit={onEdit}
          onManageModels={onManageModels}
          onDelete={onDelete}
          onClose={onClose}
        />,
      );

    // Arm confirmation
    await act(async () => {
      stdin.write('d');
    });
    await waitUntilReady();
    expect(lastFrame()).toContain('again to confirm');

    // Press Escape to cancel confirmation
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();

    expect(onDelete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('[d] Delete');

    // Press Escape again to close view
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();

    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('cancels delete confirmation when pressing other keys like navigation', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderWithProviders(
        <ProviderListView
          profiles={mockProfiles}
          activeProfileId="profile-1"
          onActivate={onActivate}
          onAdd={onAdd}
          onEdit={onEdit}
          onManageModels={onManageModels}
          onDelete={onDelete}
          onClose={onClose}
        />,
      );

    // Arm confirmation
    await act(async () => {
      stdin.write('d');
    });
    await waitUntilReady();
    expect(lastFrame()).toContain('again to confirm');

    // Press down arrow
    await act(async () => {
      stdin.write('\u001b[B'); // Down arrow
    });
    await waitUntilReady();

    expect(onDelete).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('[d] Delete');
    expect(lastFrame()).not.toContain('again to confirm');

    unmount();
  });

  it('handles activation, edit, models, and add actions', async () => {
    const { stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderListView
        profiles={mockProfiles}
        activeProfileId="profile-1"
        onActivate={onActivate}
        onAdd={onAdd}
        onEdit={onEdit}
        onManageModels={onManageModels}
        onDelete={onDelete}
        onClose={onClose}
      />,
    );

    // Press Enter to activate selected
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();
    expect(onActivate).toHaveBeenCalledWith(mockProfiles[0]);

    // Press 'e' to edit
    await act(async () => {
      stdin.write('e');
    });
    await waitUntilReady();
    expect(onEdit).toHaveBeenCalledWith(mockProfiles[0]);

    // Press 'm' to manage models
    await act(async () => {
      stdin.write('m');
    });
    await waitUntilReady();
    expect(onManageModels).toHaveBeenCalledWith(mockProfiles[0]);

    // Press 'a' to add
    await act(async () => {
      stdin.write('a');
    });
    await waitUntilReady();
    expect(onAdd).toHaveBeenCalledTimes(1);

    unmount();
  });
});
