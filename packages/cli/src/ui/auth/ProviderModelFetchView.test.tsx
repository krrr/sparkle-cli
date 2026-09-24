/**
 * @license
 * Copyright 2026 krrr
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { act } from 'react';
import { ProviderModelFetchView } from './ProviderModelFetchView.js';
import { OpenAiApiError, ProviderType, type ProviderProfile } from 'sparkle-cli-core';

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

describe('ProviderModelFetchView', () => {
  const mockProfile: ProviderProfile = {
    id: 'test-profile',
    providerType: ProviderType.USE_OPENAI,
    baseUrl: 'https://api.example.com/v1',
    models: [{ id: 'existing-model' }],
    defaultModel: 'existing-model',
  };

  const onAddModel = vi.fn();
  const onBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OPENAI_API_KEY', '');
    mockLoadApiKeyForProfile.mockResolvedValue('stored-key');
    mockListModels.mockResolvedValue(['existing-model', 'new-model-a', 'new-model-b']);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  const renderView = () =>
    renderWithProviders(
      <ProviderModelFetchView
        profile={mockProfile}
        existingModelIds={['existing-model']}
        onAddModel={onAddModel}
        onBack={onBack}
      />,
    );

  it('shows loading state then renders the fetched model list', async () => {
    mockListModels.mockReturnValue(new Promise(() => {})); // stay loading
    const { lastFrame, unmount } = await renderView();

    await waitFor(() => expect(lastFrame()).toContain('Fetching models...'));
    unmount();
  });

  it('renders fetched models and marks already added ones', async () => {
    const { lastFrame, unmount } = await renderView();

    await waitFor(() => expect(lastFrame()).toContain('new-model-a'));
    expect(lastFrame()).toContain('existing-model');
    expect(lastFrame()).toContain('✓ Added');
    expect(lastFrame()).toContain('[Enter] Add model');
    expect(lastFrame()).toContain('[Esc] Back');
    unmount();
  });

  it('adds the selected model without exiting', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } = await renderView();

    await waitFor(() => expect(lastFrame()).toContain('new-model-a'));

    // First entry is 'existing-model' (already added); move down to select it
    // and confirm the duplicate is not re-added.
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();
    expect(onAddModel).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('already added');

    await act(async () => {
      stdin.write('\u001b[B'); // down -> 'new-model-a'
    });
    await waitUntilReady();
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();
    expect(onAddModel).toHaveBeenCalledWith({ id: 'new-model-a' });
    // The component stays mounted on the fetch list after adding.
    expect(lastFrame()).toContain('new-model-a');
    unmount();
  });

  it('returns to the model list on escape', async () => {
    const { stdin, waitUntilReady, unmount } = await renderView();

    await waitFor(() => expect(mockListModels).toHaveBeenCalled());
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();
    expect(onBack).toHaveBeenCalled();
    unmount();
  });

  it('shows an actionable error and retries on r', async () => {
    mockListModels.mockRejectedValue(new OpenAiApiError('Invalid API key', 401));
    const { lastFrame, stdin, waitUntilReady, unmount } = await renderView();

    await waitFor(() => expect(lastFrame()).toContain('Failed to fetch models'));
    expect(lastFrame()).toContain('Check the API key');
    expect(lastFrame()).toContain('[r] Retry');

    mockListModels.mockResolvedValue(['recovered-model']);
    await act(async () => {
      stdin.write('r');
    });
    await waitUntilReady();
    await waitFor(() => expect(lastFrame()).toContain('recovered-model'));
    unmount();
  });

  it('shows an error when no API key is available', async () => {
    mockLoadApiKeyForProfile.mockResolvedValue(null);
    const { lastFrame, unmount } = await renderView();

    await waitFor(() => expect(lastFrame()).toContain('No API key found'));
    unmount();
  });

  it('sorts fetched models alphabetically regardless of API order', async () => {
    mockListModels.mockResolvedValue(['zeta-model', 'alpha-model', 'mango-model']);
    const { lastFrame, unmount } = await renderView();

    await waitFor(() => expect(lastFrame()).toContain('alpha-model'));
    const frame = lastFrame() ?? '';
    expect(frame.indexOf('alpha-model')).toBeLessThan(frame.indexOf('mango-model'));
    expect(frame.indexOf('mango-model')).toBeLessThan(frame.indexOf('zeta-model'));
    unmount();
  });

  it('renders at most 10 models with scroll arrows and keeps selection in view', async () => {
    mockListModels.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => `model-${String(i).padStart(2, '0')}`),
    );
    const { lastFrame, stdin, waitUntilReady, unmount } = await renderView();

    await waitFor(() => expect(lastFrame()).toContain('model-00'));

    // Only the first 10 entries are rendered; arrows indicate more content.
    const frame = () => lastFrame() ?? '';
    expect(frame()).toContain('model-00');
    expect(frame()).toContain('model-09');
    expect(frame()).not.toContain('model-10');
    expect(frame()).toContain('▲');
    expect(frame()).toContain('▼');

    // Scroll down 14 times: selection moves through model-14, the window
    // follows and eventually shows the tail of the list.
    for (let i = 0; i < 14; i++) {
      await act(async () => {
        stdin.write('\u001b[B'); // down
      });
      await waitUntilReady();
    }
    expect(frame()).toContain('model-14');
    expect(frame()).toContain('❯');
    expect(frame()).not.toContain('model-00');

    // Wrap around from the last item back to the first.
    await act(async () => {
      stdin.write('\u001b[B'); // down -> wraps to model-00
    });
    await waitUntilReady();
    expect(frame()).toContain('model-00');
    unmount();
  });
});
