/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installWindowsVtInputPatch,
  resetWindowsVtInputForTesting,
} from './windowsVtInput.js';

const mockKoffi = vi.hoisted(() => {
  const getStdHandle = vi.fn();
  const getConsoleMode = vi.fn();
  const setConsoleMode = vi.fn();
  const load = vi.fn(() => ({
    func: (definition: string) => {
      if (definition.includes('GetStdHandle')) {
        return getStdHandle;
      }
      if (definition.includes('GetConsoleMode')) {
        return getConsoleMode;
      }
      return setConsoleMode;
    },
  }));
  return { getStdHandle, getConsoleMode, setConsoleMode, load };
});

vi.mock('./koffiLoader.js', () => ({
  loadKoffi: () => Promise.resolve({ default: { load: mockKoffi.load } }),
}));

const ENABLE_EXTENDED_FLAGS = 0x0080;
const ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200;

describe('installWindowsVtInputPatch', () => {
  let originalStdin: NodeJS.ReadStream | undefined;
  let platformSpy: ReturnType<typeof vi.spyOn> | undefined;

  const mockStdin = {
    isTTY: true,
    setRawMode: vi.fn((_mode: boolean) => mockStdin),
  };

  beforeEach(() => {
    resetWindowsVtInputForTesting();
    mockStdin.isTTY = true;
    mockKoffi.getStdHandle.mockReset();
    mockKoffi.getConsoleMode.mockReset();
    mockKoffi.setConsoleMode.mockReset();
    mockKoffi.load.mockClear();

    originalStdin = process.stdin;

    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      configurable: true,
    });
    // Recreate the spy: after installation the patch replaces setRawMode,
    // so a previous test's wrapper must not leak into this one.
    mockStdin.setRawMode = vi.fn((_mode: boolean) => mockStdin);

    platformSpy = vi.spyOn(process, 'platform', 'get');
  });

  afterEach(() => {
    platformSpy?.mockRestore();
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  it('is a no-op on non-Windows platforms', async () => {
    platformSpy!.mockReturnValue('linux');
    const setRawModeBefore = mockStdin.setRawMode;
    await installWindowsVtInputPatch();
    await installWindowsVtInputPatch();

    expect(mockKoffi.load).not.toHaveBeenCalled();
    // setRawMode was not replaced.
    expect(mockStdin.setRawMode).toBe(setRawModeBefore);
  });

  it('is a no-op when stdin is not a TTY', async () => {
    platformSpy!.mockReturnValue('win32');
    mockStdin.isTTY = false;
    await installWindowsVtInputPatch();

    expect(mockKoffi.load).not.toHaveBeenCalled();
    expect(mockStdin.setRawMode).toHaveBeenCalledTimes(0);
  });

  it('re-applies ENABLE_VIRTUAL_TERMINAL_INPUT after setRawMode(true)', async () => {
    platformSpy!.mockReturnValue('win32');
    const handle = { fakeHandle: true };
    mockKoffi.getStdHandle.mockReturnValue(handle);
    mockKoffi.getConsoleMode.mockImplementation(
      (_h: unknown, out: [number]) => {
        out[0] = 0x0008; // libuv raw mode: ENABLE_WINDOW_INPUT only
        return 1;
      },
    );
    mockKoffi.setConsoleMode.mockReturnValue(1);

    await installWindowsVtInputPatch();
    await installWindowsVtInputPatch(); // idempotent
    expect(mockKoffi.load).toHaveBeenCalledTimes(1);

    const rawModeResult = mockStdin.setRawMode(true);
    expect(rawModeResult).toBe(mockStdin);

    expect(mockKoffi.getStdHandle).toHaveBeenCalledWith(-10);
    expect(mockKoffi.setConsoleMode).toHaveBeenCalledWith(
      handle,
      0x0008 | ENABLE_EXTENDED_FLAGS | ENABLE_VIRTUAL_TERMINAL_INPUT,
    );

    // setRawMode(false) restores raw mode without touching VT input flags.
    mockKoffi.setConsoleMode.mockClear();
    mockStdin.setRawMode(false);
    expect(mockKoffi.setConsoleMode).not.toHaveBeenCalled();
  });

  it('does not call SetConsoleMode when GetConsoleMode fails', async () => {
    platformSpy!.mockReturnValue('win32');
    mockKoffi.getStdHandle.mockReturnValue({ fakeHandle: true });
    mockKoffi.getConsoleMode.mockReturnValue(0); // failure

    await installWindowsVtInputPatch();

    mockStdin.setRawMode(true);

    expect(mockKoffi.getConsoleMode).toHaveBeenCalledTimes(1);
    expect(mockKoffi.setConsoleMode).not.toHaveBeenCalled();
  });

  it('keeps raw mode working when koffi fails to load', async () => {
    platformSpy!.mockReturnValue('win32');
    mockKoffi.load.mockImplementation(() => {
      throw new Error('cannot find module');
    });

    await installWindowsVtInputPatch();

    expect(mockKoffi.getStdHandle).not.toHaveBeenCalled();
    const result = mockStdin.setRawMode(true);
    expect(result).toBe(mockStdin);
    expect(mockKoffi.setConsoleMode).not.toHaveBeenCalled();
  });
});
