/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as core from 'sparkle-cli-core';
import type { MockInstance } from 'vitest';
import { EditorSettingsManager } from './editorSettingsManager.js';

vi.mock('sparkle-cli-core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('sparkle-cli-core')>();
  return {
    ...mod,
    hasValidEditorCommand: vi.fn(),
    allowEditorTypeInSandbox: vi.fn(),
    EDITOR_DISPLAY_NAMES: {
      vscode: 'VS Code',
      vim: 'Vim',
      nano: 'Nano',
    },
  };
});

describe('EditorSettingsManager', () => {
  let hasValidEditorCommandMock: MockInstance<
    typeof core.hasValidEditorCommand
  >;
  let allowEditorTypeInSandboxMock: MockInstance<
    typeof core.allowEditorTypeInSandbox
  >;

  beforeEach(() => {
    hasValidEditorCommandMock = vi.mocked(core.hasValidEditorCommand);
    allowEditorTypeInSandboxMock = vi.mocked(core.allowEditorTypeInSandbox);

    hasValidEditorCommandMock.mockReturnValue(true);
    allowEditorTypeInSandboxMock.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('construction performs no editor probing', () => {
    new EditorSettingsManager();
    expect(hasValidEditorCommandMock).not.toHaveBeenCalled();
    expect(allowEditorTypeInSandboxMock).not.toHaveBeenCalled();
  });

  it('editors are computed on first access and the result is cached', () => {
    const manager = new EditorSettingsManager();
    const result1 = manager.getAvailableEditorDisplays();

    expect(hasValidEditorCommandMock).toHaveBeenCalledTimes(3);

    const result2 = manager.getAvailableEditorDisplays();
    expect(hasValidEditorCommandMock).toHaveBeenCalledTimes(3); // no additional calls

    expect(result1).toBe(result2);
  });

  it('"None" is always listed first; uninstalled editors are labeled (Not installed) and disabled', () => {
    hasValidEditorCommandMock.mockImplementation((type: string) => {
      if (type === 'nano') return false;
      return true;
    });

    const manager = new EditorSettingsManager();
    const result = manager.getAvailableEditorDisplays();

    expect(result[0]).toEqual({
      name: 'None',
      type: 'not_set',
      disabled: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nanoEditor = result.find((e) => e.type === ('nano' as any));
    expect(nanoEditor?.name).toBe('Nano (Not installed)');
    expect(nanoEditor?.disabled).toBe(true);
  });

  it('editors disallowed in the sandbox are labeled (Not available in sandbox) and disabled', () => {
    allowEditorTypeInSandboxMock.mockImplementation((type: string) => {
      if (type === 'vscode') return false;
      return true;
    });

    const manager = new EditorSettingsManager();
    const result = manager.getAvailableEditorDisplays();

    const vscodeEditor = result.find((e) => e.type === 'vscode');
    expect(vscodeEditor?.name).toBe('VS Code (Not available in sandbox)');
    expect(vscodeEditor?.disabled).toBe(true);
  });
});
