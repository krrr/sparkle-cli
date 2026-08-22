/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { act } from 'react';
import { ProviderModelEditorView } from './ProviderModelEditorView.js';

describe('ProviderModelEditorView', () => {
  const onSave = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders form in add mode', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ProviderModelEditorView onSave={onSave} onCancel={onCancel} />,
    );

    expect(lastFrame()).toContain('Add Model');
    expect(lastFrame()).toContain('Model ID:');
    expect(lastFrame()).toContain('Model Tier:');
    expect(lastFrame()).toContain('Reasoning Effort:');
    expect(lastFrame()).toContain('Esc to save & return');
    unmount();
  });

  it('renders form in edit mode with initial model values', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ProviderModelEditorView
        model={{ id: 'gemini-2.5-flash', tier: 'flash' }}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    expect(lastFrame()).toContain('Edit Model: gemini-2.5-flash');
    expect(lastFrame()).toContain('gemini-2.5-flash');
    expect(lastFrame()).toContain('[●] flash');
    unmount();
  });

  it('saves model when submitting on the tier field with Enter', async () => {
    const { stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelEditorView onSave={onSave} onCancel={onCancel} />,
    );

    // Type model id
    await act(async () => {
      stdin.write('gpt-4.5');
    });
    await waitUntilReady();

    // Press Enter to move to tier field
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    // Toggle tier using right arrow (none -> flash-lite -> flash -> pro)
    await act(async () => {
      stdin.write('\u001b[C'); // right arrow -> flash-lite
    });
    await waitUntilReady();
    await act(async () => {
      stdin.write('\u001b[C'); // right arrow -> flash
    });
    await waitUntilReady();

    // Press Enter on tier to submit form
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        id: 'gpt-4.5',
        tier: 'flash',
      });
    });

    unmount();
  });

  it('saves and exits when pressing Esc with valid ID', async () => {
    const { stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelEditorView onSave={onSave} onCancel={onCancel} />,
    );

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
      expect(onSave).toHaveBeenCalledWith({
        id: 'claude-3-5-sonnet',
        tier: undefined,
      });
    });

    unmount();
  });

  it('cancels when pressing Esc with empty ID', async () => {
    const { stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelEditorView onSave={onSave} onCancel={onCancel} />,
    );

    // Press Escape with empty ID
    await act(async () => {
      stdin.write('\u001b');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
    });

    unmount();
  });

  it('cycles reasoning effort and saves the selection', async () => {
    const { stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelEditorView onSave={onSave} onCancel={onCancel} />,
    );

    // Type model id
    await act(async () => {
      stdin.write('deepseek-reasoner');
    });
    await waitUntilReady();

    // Enter moves from the id field to tier
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    // Down arrow moves to the reasoning effort field
    await act(async () => {
      stdin.write('\u001b[B');
    });
    await waitUntilReady();

    // Right arrow cycles default -> none
    await act(async () => {
      stdin.write('\u001b[C');
    });
    await waitUntilReady();

    // Press Enter on the effort field to submit
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'deepseek-reasoner',
          generateConfig: { reasoningEffort: 'none' },
        }),
      );
    });

    unmount();
  });

  it('preserves fields without UI controls when editing', async () => {
    const { stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelEditorView
        model={{
          id: 'reasoner-v1',
          tier: 'flash',
          contextWindow: 64000,
          features: { thinking: false },
        }}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    await waitUntilReady();
    await act(async () => {
      stdin.write('\x1b');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'reasoner-v1',
          tier: 'flash',
          contextWindow: 64000,
          features: { thinking: false },
        }),
      );
    });

    unmount();
  });

  it('navigates fields with Tab and arrow keys', async () => {
    const { stdin, waitUntilReady, unmount } = await renderWithProviders(
      <ProviderModelEditorView onSave={onSave} onCancel={onCancel} />,
    );

    // Down arrow to tier
    await act(async () => {
      stdin.write('\u001b[B');
    });
    await waitUntilReady();

    // Up arrow to ID
    await act(async () => {
      stdin.write('\u001b[A');
    });
    await waitUntilReady();

    // Tab to tier
    await act(async () => {
      stdin.write('\t');
    });
    await waitUntilReady();

    unmount();
  });
});
