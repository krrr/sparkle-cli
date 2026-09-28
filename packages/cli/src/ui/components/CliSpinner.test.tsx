/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../test-utils/render.js';
import { createMockSettings } from '../../test-utils/settings.js';
import { CliSpinner, spinners } from './CliSpinner.js';
import { debugState } from '../debug.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Opt into the real animated implementation. test-setup.ts mocks CliSpinner
// globally so all other tests get a deterministic first frame.
vi.mock('./CliSpinner.js', async (importOriginal) =>
  importOriginal<typeof import('./CliSpinner.js')>(),
);

describe('<CliSpinner />', () => {
  beforeEach(() => {
    debugState.debugNumAnimatedComponents = 0;
  });

  it('should increment debugNumAnimatedComponents on mount and decrement on unmount', async () => {
    expect(debugState.debugNumAnimatedComponents).toBe(0);
    const { unmount } = await renderWithProviders(<CliSpinner />);
    expect(debugState.debugNumAnimatedComponents).toBe(1);
    unmount();
    expect(debugState.debugNumAnimatedComponents).toBe(0);
  });

  it('should not render when showSpinner is false', async () => {
    const settings = createMockSettings({ ui: { showSpinner: false } });
    const { lastFrame, unmount } = await renderWithProviders(<CliSpinner />, {
      settings,
    });
    expect(lastFrame({ allowEmpty: true })).toBe('');
    unmount();
  });

  it('should not start the frame timer when showSpinner is false', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    try {
      const settings = createMockSettings({ ui: { showSpinner: false } });
      const { unmount } = await renderWithProviders(<CliSpinner />, {
        settings,
      });
      const frameTimerCalls = setIntervalSpy.mock.calls.filter(
        ([, delay]) => delay === spinners.dots.interval,
      );
      expect(frameTimerCalls).toHaveLength(0);
      unmount();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  it('should start the frame timer when showSpinner is enabled', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    try {
      const { unmount } = await renderWithProviders(<CliSpinner />);
      const frameTimerCalls = setIntervalSpy.mock.calls.filter(
        ([, delay]) => delay === spinners.dots.interval,
      );
      expect(frameTimerCalls).toHaveLength(1);
      unmount();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });
});
