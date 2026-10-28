/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook } from '../../test-utils/render.js';
import { useTerminalTheme } from './useTerminalTheme.js';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeFakeConfig, type Config } from 'sparkle-cli-core';
import os from 'node:os';
import { themeManager } from '../themes/theme-manager.js';

const mockWrite = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockHandleThemeSelect = vi.fn();
const mockQueryTerminalBackground = vi.fn();

// The hook reads the active theme from themeManager, so tests drive the
// "current theme" through this variable.
let mockActiveThemeName = 'default';

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useStdout: () => ({
      stdout: {
        write: mockWrite,
      },
    }),
  };
});

vi.mock('../contexts/TerminalContext.js', () => ({
  useTerminalContext: () => ({
    subscribe: mockSubscribe,
    unsubscribe: mockUnsubscribe,
    queryTerminalBackground: mockQueryTerminalBackground,
  }),
}));

const mockSettings = {
  merged: {
    ui: {
      theme: 'default',
      autoThemeSwitching: true,
      terminalBackgroundPollingInterval: 60,
    },
  },
};

vi.mock('../contexts/SettingsContext.js', () => ({
  useSettings: () => mockSettings,
}));

vi.mock('../themes/theme-manager.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../themes/theme-manager.js')>();
  return {
    ...actual,
    themeManager: {
      getActiveTheme: vi.fn(() => ({ name: mockActiveThemeName })),
      getThemeVariant: vi.fn((name: string) =>
        name === 'default'
          ? { name: 'default-light' }
          : name === 'default-light'
            ? { name: 'default' }
            : undefined,
      ),
      getSwitchedThemeName: vi.fn(
        (name: string, luminance: number): string | undefined => {
          if (name === 'default' && luminance > 140) return 'default-light';
          if (name === 'default-light' && luminance < 110) return 'default';
          return undefined;
        },
      ),
      setTerminalBackground: vi.fn(),
    },
    DEFAULT_THEME: { name: 'default' },
  };
});

describe('useTerminalTheme', () => {
  let config: Config;

  beforeEach(() => {
    vi.useFakeTimers();
    config = makeFakeConfig({
      targetDir: os.tmpdir(),
    });
    config.setTerminalBackground('#000000');
    vi.spyOn(config, 'setTerminalBackground');

    mockWrite.mockClear();
    mockSubscribe.mockClear();
    mockUnsubscribe.mockClear();
    mockHandleThemeSelect.mockClear();
    mockQueryTerminalBackground.mockClear();
    vi.mocked(themeManager.setTerminalBackground).mockClear();
    vi.mocked(themeManager.getSwitchedThemeName).mockClear();
    mockSettings.merged.ui.autoThemeSwitching = true;
    mockActiveThemeName = 'default';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should subscribe to terminal background events on mount', async () => {
    const { unmount } = await renderHook(() =>
      useTerminalTheme(mockHandleThemeSelect, config, vi.fn()),
    );
    expect(mockSubscribe).toHaveBeenCalled();
    unmount();
  });

  it('should unsubscribe on unmount', async () => {
    const { unmount } = await renderHook(() =>
      useTerminalTheme(mockHandleThemeSelect, config, vi.fn()),
    );
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('should poll for terminal background', async () => {
    const { unmount } = await renderHook(() =>
      useTerminalTheme(mockHandleThemeSelect, config, vi.fn()),
    );

    vi.advanceTimersByTime(60000);
    expect(mockQueryTerminalBackground).toHaveBeenCalled();
    unmount();
  });

  it('should not poll while the active theme has no light/dark counterpart', async () => {
    mockActiveThemeName = 'Dracula';
    const { unmount } = await renderHook(() =>
      useTerminalTheme(mockHandleThemeSelect, config, vi.fn()),
    );

    vi.advanceTimersByTime(60000);
    expect(mockQueryTerminalBackground).not.toHaveBeenCalled();
    unmount();
  });

  it('should not poll if terminal background is undefined at startup', async () => {
    config.getTerminalBackground = vi.fn().mockReturnValue(undefined);
    const { unmount } = await renderHook(() =>
      useTerminalTheme(mockHandleThemeSelect, config, vi.fn()),
    );

    vi.advanceTimersByTime(60000);
    expect(mockQueryTerminalBackground).not.toHaveBeenCalled();
    unmount();
  });

  it('should switch to light theme when background is light and not call refreshStatic directly', async () => {
    const refreshStatic = vi.fn();
    const { unmount } = await renderHook(() =>
      useTerminalTheme(mockHandleThemeSelect, config, refreshStatic),
    );

    const handler = mockSubscribe.mock.calls[0][0];

    handler('rgb:ffff/ffff/ffff');

    expect(config.setTerminalBackground).toHaveBeenCalledWith('#ffffff');
    expect(themeManager.setTerminalBackground).toHaveBeenCalledWith('#ffffff');
    expect(refreshStatic).not.toHaveBeenCalled();
    expect(themeManager.getSwitchedThemeName).toHaveBeenCalledWith('default', 255);
    expect(mockHandleThemeSelect).toHaveBeenCalledWith(
      'default-light',
      expect.anything(),
    );
    unmount();
  });

  it('should switch to dark theme when background is dark', async () => {
    mockActiveThemeName = 'default-light';

    config.setTerminalBackground('#ffffff');

    const refreshStatic = vi.fn();
    const { unmount } = await renderHook(() =>
      useTerminalTheme(mockHandleThemeSelect, config, refreshStatic),
    );

    const handler = mockSubscribe.mock.calls[0][0];

    handler('rgb:0000/0000/0000');

    expect(config.setTerminalBackground).toHaveBeenCalledWith('#000000');
    expect(themeManager.setTerminalBackground).toHaveBeenCalledWith('#000000');
    expect(refreshStatic).not.toHaveBeenCalled();
    expect(mockHandleThemeSelect).toHaveBeenCalledWith('default', expect.anything());

    unmount();
  });

  it('should switch a paired non-default theme to its counterpart', async () => {
    mockActiveThemeName = 'Ayu';
    vi.mocked(themeManager.getSwitchedThemeName).mockReturnValueOnce('Ayu Light');

    const { unmount } = await renderHook(() =>
      useTerminalTheme(mockHandleThemeSelect, config, vi.fn()),
    );

    const handler = mockSubscribe.mock.calls[0][0];
    handler('rgb:ffff/ffff/ffff');

    expect(themeManager.getSwitchedThemeName).toHaveBeenCalledWith('Ayu', 255);
    expect(mockHandleThemeSelect).toHaveBeenCalledWith('Ayu Light', expect.anything());
    unmount();
  });

  it('should not update config or call refreshStatic on repeated identical background reports', async () => {
    const refreshStatic = vi.fn();
    await renderHook(() =>
      useTerminalTheme(mockHandleThemeSelect, config, refreshStatic),
    );

    const handler = mockSubscribe.mock.calls[0][0];

    handler('rgb:0000/0000/0000');

    expect(config.setTerminalBackground).not.toHaveBeenCalled();
    expect(themeManager.setTerminalBackground).not.toHaveBeenCalled();
    expect(refreshStatic).not.toHaveBeenCalled();

    expect(mockHandleThemeSelect).not.toHaveBeenCalled();
  });

  it('should switch theme even if terminal background report is identical to previousColor if current theme is mismatched', async () => {
    // Background is dark at startup
    config.setTerminalBackground('#000000');
    vi.mocked(config.setTerminalBackground).mockClear();
    // But theme is light
    mockActiveThemeName = 'default-light';

    const refreshStatic = vi.fn();
    const { unmount } = await renderHook(() =>
      useTerminalTheme(mockHandleThemeSelect, config, refreshStatic),
    );

    const handler = mockSubscribe.mock.calls[0][0];

    // Terminal reports the same dark background
    handler('rgb:0000/0000/0000');

    expect(config.setTerminalBackground).not.toHaveBeenCalled();
    expect(themeManager.setTerminalBackground).not.toHaveBeenCalled();
    expect(refreshStatic).not.toHaveBeenCalled();
    // But it SHOULD select the dark theme because of the mismatch!
    expect(mockHandleThemeSelect).toHaveBeenCalledWith('default', expect.anything());

    unmount();
  });

  it('should refresh static output when only the background color changes', async () => {
    const refreshStatic = vi.fn();
    const { unmount } = await renderHook(() =>
      useTerminalTheme(mockHandleThemeSelect, config, refreshStatic),
    );

    const handler = mockSubscribe.mock.calls[0][0];

    // Same polarity (dark) but a different shade, so no theme switch is needed.
    handler('rgb:1a1a/1a1a/1a1a');

    expect(config.setTerminalBackground).toHaveBeenCalledWith('#1a1a1a');
    expect(mockHandleThemeSelect).not.toHaveBeenCalled();
    expect(refreshStatic).toHaveBeenCalled();
    unmount();
  });

  it('should not switch theme if autoThemeSwitching is disabled', async () => {
    mockSettings.merged.ui.autoThemeSwitching = false;
    const { unmount } = await renderHook(() =>
      useTerminalTheme(mockHandleThemeSelect, config, vi.fn()),
    );

    vi.advanceTimersByTime(60000);
    expect(mockQueryTerminalBackground).not.toHaveBeenCalled();

    mockSettings.merged.ui.autoThemeSwitching = true;
    unmount();
  });
});
