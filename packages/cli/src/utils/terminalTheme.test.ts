/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { setupTerminalAndTheme } from './terminalTheme.js';
import { terminalCapabilityManager } from '../ui/utils/terminalCapabilityManager.js';
import { themeManager } from '../ui/themes/theme-manager.js';
import { coreEvents, debugLogger, type Config } from 'sparkle-cli-core';
import type { LoadedSettings } from '../config/settings.js';
import type { Theme } from '../ui/themes/theme.js';
import { createMockSettings } from '../test-utils/settings.js';

vi.mock('../ui/utils/terminalCapabilityManager.js', () => ({
  terminalCapabilityManager: {
    detectCapabilities: vi.fn(),
    getTerminalBackgroundColor: vi.fn(),
  },
}));

vi.mock('../ui/themes/theme-manager.js', () => ({
  themeManager: {
    loadCustomThemes: vi.fn(),
    setActiveTheme: vi.fn(),
    getActiveTheme: vi.fn(),
    setTerminalBackground: vi.fn(),
    isThemeCompatible: vi.fn(),
    getSwitchedThemeName: vi.fn(),
    getAllThemes: vi.fn().mockReturnValue([]),
  },
  DEFAULT_THEME: { name: 'Default Dark' },
}));

describe('setupTerminalAndTheme', () => {
  let mockConfig: Config;
  let mockSettings: LoadedSettings;
  let setValueSpy: MockInstance<LoadedSettings['setValue']>;
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(coreEvents, 'emitFeedback').mockImplementation(() => {});
    vi.spyOn(debugLogger, 'warn').mockImplementation(() => {});
    vi.spyOn(debugLogger, 'debug').mockImplementation(() => {});

    mockConfig = {
      isInteractive: vi.fn().mockReturnValue(true),
      setTerminalBackground: vi.fn(),
    } as Partial<Config> as Config;
    mockSettings = createMockSettings({
      merged: {
        ui: {
          customThemes: {},
          theme: 'Dracula',
          autoThemeSwitching: true,
        },
      },
    });
    setValueSpy = vi.spyOn(mockSettings, 'setValue').mockImplementation(() => {});

    // Mock process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
  });

  it('should emit warning when theme is incompatible and autoThemeSwitching is enabled', async () => {
    vi.mocked(terminalCapabilityManager.getTerminalBackgroundColor).mockReturnValue(
      '#ffffff',
    ); // Light
    vi.mocked(themeManager.setActiveTheme).mockReturnValue(true);
    vi.mocked(themeManager.getActiveTheme).mockReturnValue({
      name: 'Dracula',
      type: 'dark',
    } as Theme);
    vi.mocked(themeManager.isThemeCompatible).mockReturnValue(false);

    await setupTerminalAndTheme(mockConfig, mockSettings);

    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining(
        "Theme 'Dracula' (dark) might look incorrect on your light terminal background",
      ),
    );
  });

  it('should NOT emit warning when theme is incompatible but autoThemeSwitching is DISABLED', async () => {
    mockSettings.merged.ui.autoThemeSwitching = false;
    vi.mocked(terminalCapabilityManager.getTerminalBackgroundColor).mockReturnValue(
      '#ffffff',
    ); // Light
    vi.mocked(themeManager.setActiveTheme).mockReturnValue(true);
    vi.mocked(themeManager.getActiveTheme).mockReturnValue({
      name: 'Dracula',
      type: 'dark',
    } as Theme);
    vi.mocked(themeManager.isThemeCompatible).mockReturnValue(false);

    await setupTerminalAndTheme(mockConfig, mockSettings);

    expect(coreEvents.emitFeedback).not.toHaveBeenCalled();
  });

  it('should switch the active theme instead of warning when a default theme mismatches', async () => {
    mockSettings.merged.ui.theme = 'Default Light';
    vi.mocked(terminalCapabilityManager.getTerminalBackgroundColor).mockReturnValue(
      '#000000',
    ); // Dark
    vi.mocked(themeManager.setActiveTheme).mockReturnValue(true);
    vi.mocked(themeManager.getActiveTheme).mockReturnValue({
      name: 'Default Light',
      type: 'light',
    } as Theme);
    vi.mocked(themeManager.isThemeCompatible).mockReturnValue(false);
    vi.mocked(themeManager.getSwitchedThemeName).mockReturnValue('Default Dark');

    await setupTerminalAndTheme(mockConfig, mockSettings);

    // The last setActiveTheme call is the corrective switch to the dark theme.
    expect(themeManager.setActiveTheme).toHaveBeenLastCalledWith('Default Dark');
    expect(coreEvents.emitFeedback).not.toHaveBeenCalled();
    // The configured theme must not be overwritten in the user's settings.
    expect(setValueSpy).not.toHaveBeenCalled();
  });

  it('should switch a paired non-default theme to its counterpart instead of warning', async () => {
    mockSettings.merged.ui.theme = 'Ayu';
    vi.mocked(terminalCapabilityManager.getTerminalBackgroundColor).mockReturnValue(
      '#ffffff',
    ); // Light
    vi.mocked(themeManager.setActiveTheme).mockReturnValue(true);
    vi.mocked(themeManager.getActiveTheme).mockReturnValue({
      name: 'Ayu',
      type: 'dark',
    } as Theme);
    vi.mocked(themeManager.isThemeCompatible).mockReturnValue(false);
    vi.mocked(themeManager.getSwitchedThemeName).mockReturnValue('Ayu Light');

    await setupTerminalAndTheme(mockConfig, mockSettings);

    expect(themeManager.getSwitchedThemeName).toHaveBeenCalledWith('Ayu', 255);
    expect(themeManager.setActiveTheme).toHaveBeenLastCalledWith('Ayu Light');
    expect(coreEvents.emitFeedback).not.toHaveBeenCalled();
  });

  it('should still emit warning when the mismatched theme cannot be switched', async () => {
    mockSettings.merged.ui.theme = 'Dracula';
    vi.mocked(terminalCapabilityManager.getTerminalBackgroundColor).mockReturnValue(
      '#ffffff',
    ); // Light
    vi.mocked(themeManager.setActiveTheme).mockReturnValue(true);
    vi.mocked(themeManager.getActiveTheme).mockReturnValue({
      name: 'Dracula',
      type: 'dark',
    } as Theme);
    vi.mocked(themeManager.isThemeCompatible).mockReturnValue(false);
    // Dracula has no light counterpart.
    vi.mocked(themeManager.getSwitchedThemeName).mockReturnValue(undefined);

    await setupTerminalAndTheme(mockConfig, mockSettings);

    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining(
        "Theme 'Dracula' (dark) might look incorrect on your light terminal background",
      ),
    );
  });

  it('should emit warning when the corrective switch fails', async () => {
    mockSettings.merged.ui.theme = 'Ayu';
    vi.mocked(terminalCapabilityManager.getTerminalBackgroundColor).mockReturnValue(
      '#ffffff',
    ); // Light
    // The initial activation succeeds, the corrective switch fails.
    vi.mocked(themeManager.setActiveTheme)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    vi.mocked(themeManager.getActiveTheme).mockReturnValue({
      name: 'Ayu',
      type: 'dark',
    } as Theme);
    vi.mocked(themeManager.isThemeCompatible).mockReturnValue(false);
    vi.mocked(themeManager.getSwitchedThemeName).mockReturnValue('Ayu Light');

    await setupTerminalAndTheme(mockConfig, mockSettings);

    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'warning',
      expect.stringContaining(
        "Theme 'Ayu' (dark) might look incorrect on your light terminal background",
      ),
    );
  });
});
