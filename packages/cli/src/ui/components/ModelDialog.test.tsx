/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { ModelDialog } from './ModelDialog.js';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { createMockSettings } from '../../test-utils/settings.js';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  SPARKLE_MODEL_ALIAS_AUTO,
  ProviderType,
  type Config,
  type ProviderProfile,
} from 'sparkle-cli-core';

describe('<ModelDialog />', () => {
  const mockSetModel = vi.fn();
  const mockGetModel = vi.fn();
  const mockOnClose = vi.fn();
  const mockUpdateProfile = vi.fn();
  const mockSetDefaultModel = vi.fn();
  const mockAddModel = vi.fn();
  const mockUpdateModel = vi.fn();
  const mockRemoveModel = vi.fn();

  const fakeProfile: ProviderProfile = {
    id: 'p1',
    providerType: ProviderType.USE_GEMINI,
    models: [{ id: DEFAULT_GEMINI_FLASH_MODEL }, { id: DEFAULT_GEMINI_MODEL }],
    defaultModel: DEFAULT_GEMINI_FLASH_MODEL,
  };

  const mockProfileService = {
    getActiveProfile: vi.fn().mockReturnValue(fakeProfile),
    updateProfile: mockUpdateProfile,
    setDefaultModel: mockSetDefaultModel,
    addModel: mockAddModel,
    updateModel: mockUpdateModel,
    removeModel: mockRemoveModel,
  };

  const mockConfig = {
    setModel: mockSetModel,
    getModel: mockGetModel,
    getIdeMode: () => false,
    getSessionId: () => 'test-session-id',
    getProviderProfileService: vi.fn().mockReturnValue(mockProfileService),
  } as unknown as Config;

  beforeEach(() => {
    vi.resetAllMocks();
    mockGetModel.mockReturnValue(DEFAULT_GEMINI_FLASH_MODEL);
    mockProfileService.getActiveProfile.mockReturnValue(fakeProfile);
    mockSetDefaultModel.mockResolvedValue(undefined);
    mockAddModel.mockResolvedValue(undefined);
    mockUpdateModel.mockResolvedValue(undefined);
    mockRemoveModel.mockResolvedValue(undefined);
    vi.mocked(mockConfig.getProviderProfileService).mockReturnValue(
      mockProfileService as unknown as ReturnType<
        Config['getProviderProfileService']
      >,
    );
  });

  const renderComponent = async (configValue = mockConfig) => {
    const settings = createMockSettings({});

    const result = await renderWithProviders(
      <ModelDialog onClose={mockOnClose} />,
      {
        config: configValue,
        settings,
      },
    );
    return result;
  };

  it('renders the model list for the active profile with Auto virtual option', async () => {
    const { lastFrame, unmount } = await renderComponent();
    expect(lastFrame()).toContain('Select Model (p1)');
    expect(lastFrame()).toContain('Auto');
    expect(lastFrame()).toContain('gemini-flash-latest');
    expect(lastFrame()).toContain('gemini-pro-latest');
    expect(lastFrame()).toContain('Remember model for future sessions: false');
    unmount();
  });

  it('shows "tier: not set" for profile models without a configured tier', async () => {
    const { lastFrame, unmount } = await renderComponent();

    // Both fakeProfile models lack a tier; the non-default one (gemini-pro-latest)
    // should show the hint instead of no description at all.
    await waitFor(() => {
      expect(lastFrame()).toContain('tier: not set');
      expect(lastFrame()).toContain('remembered, tier: not set');
    });
    unmount();
  });

  it('sets model and closes when a model is selected', async () => {
    const { stdin, waitUntilReady, unmount } = await renderComponent();

    // Select the currently highlighted model (gemini-flash-latest) directly with Enter
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenCalledWith(
        DEFAULT_GEMINI_FLASH_MODEL,
        true, // isTemporary = true because persistMode is false
      );
      expect(mockOnClose).toHaveBeenCalled();
    });
    unmount();
  });

  it('persists default model to profile when Tab toggle is active', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderComponent();

    // Toggle persist mode with Tab
    await act(async () => {
      stdin.write('\t');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(lastFrame()).toContain('Remember model for future sessions: true');
    });

    // Move down from Flash (index 1) to Pro model (index 2) and select
    await act(async () => {
      stdin.write('\u001B[B');
    });
    await waitUntilReady();
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenCalledWith(DEFAULT_GEMINI_MODEL, false);
      expect(mockSetDefaultModel).toHaveBeenCalledWith(
        fakeProfile.id,
        DEFAULT_GEMINI_MODEL,
      );
      expect(mockOnClose).toHaveBeenCalled();
    });
    unmount();
  });

  it('can select and persist Auto model to profile', async () => {
    const { stdin, waitUntilReady, unmount } = await renderComponent();

    // Toggle persist mode with Tab
    await act(async () => {
      stdin.write('\t');
    });
    await waitUntilReady();

    // Move up from Flash (index 1) to Auto (index 0) and select
    await act(async () => {
      stdin.write('\u001B[A');
    });
    await waitUntilReady();
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenCalledWith(
        SPARKLE_MODEL_ALIAS_AUTO,
        false,
      );
      expect(mockSetDefaultModel).toHaveBeenCalledWith(
        fakeProfile.id,
        SPARKLE_MODEL_ALIAS_AUTO,
      );
      expect(mockOnClose).toHaveBeenCalled();
    });
    unmount();
  });

  it('closes dialog on escape', async () => {
    const { stdin, waitUntilReady, unmount } = await renderComponent();

    await act(async () => {
      stdin.write('\u001B'); // Escape
    });
    await act(async () => {
      await waitUntilReady();
    });

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
    unmount();
  });

  it('opens the provider model settings view when m is pressed', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderComponent();

    expect(lastFrame()).toContain('Manage models');

    await act(async () => {
      stdin.write('m');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(lastFrame()).toContain('Models for: p1');
      expect(lastFrame()).toContain('Add model');
      expect(lastFrame()).toContain(DEFAULT_GEMINI_FLASH_MODEL);
    });
    unmount();
  });

  it('returns to the model list from the settings view with Escape', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderComponent();

    await act(async () => {
      stdin.write('m');
    });
    await waitUntilReady();

    await waitFor(() => expect(lastFrame()).toContain('Models for: p1'));

    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();

    await waitFor(() => expect(lastFrame()).toContain('Select Model (p1)'));
    expect(mockOnClose).not.toHaveBeenCalled();

    // Escape again closes the dialog itself
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();

    await waitFor(() => expect(mockOnClose).toHaveBeenCalled());
    unmount();
  });

  it('sets the default model from the settings view with s', async () => {
    const { stdin, waitUntilReady, unmount } = await renderComponent();

    await act(async () => {
      stdin.write('m');
    });
    await waitUntilReady();

    await act(async () => {
      stdin.write('s');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(mockSetDefaultModel).toHaveBeenCalledWith(
        fakeProfile.id,
        DEFAULT_GEMINI_FLASH_MODEL,
      );
    });
    unmount();
  });

  it('opens the settings view via m when the provider has no models', async () => {
    mockProfileService.getActiveProfile.mockReturnValue({
      ...fakeProfile,
      models: [],
      defaultModel: undefined,
    });
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderComponent();

    expect(lastFrame()).toContain('No models configured for provider "p1"');

    await act(async () => {
      stdin.write('m');
    });
    await waitUntilReady();

    await waitFor(() => expect(lastFrame()).toContain('Models for: p1'));
    unmount();
  });

  it('renders guidance when no provider is active', async () => {
    mockProfileService.getActiveProfile.mockReturnValue(undefined);
    const { lastFrame, unmount } = await renderComponent();
    expect(lastFrame()).toContain('No active provider configured');
    unmount();
  });
});
