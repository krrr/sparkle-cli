/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { debugLogger } from 'sparkle-cli-core';
import { loadKoffi } from './koffiLoader.js';

// Windows console input mode flags (wincon.h).
//
// ENABLE_EXTENDED_FLAGS must be set alongside ENABLE_VIRTUAL_TERMINAL_INPUT
// for the console to honor VT input mode (see Microsoft's console mode docs).
const ENABLE_EXTENDED_FLAGS = 0x0080;
const ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200;
// nStdHandle value for GetStdHandle(STD_INPUT_HANDLE).
const STD_INPUT_HANDLE = -10;

/** Minimal surface of the Win32 console mode API used to toggle VT input. */
interface Win32ConsoleModeApi {
  GetStdHandle(nStdHandle: number): unknown;
  GetConsoleMode(hConsoleHandle: unknown, mode: [number]): number;
  SetConsoleMode(hConsoleHandle: unknown, mode: number): number;
}

let consoleApi: Win32ConsoleModeApi | undefined;
let patchInstalled = false;

async function loadConsoleModeApi(): Promise<void> {
  if (consoleApi !== undefined) {
    return;
  }
  try {
    // koffi is an optional dependency: it is only loaded on Windows where a
    // console is available. When it is missing (e.g. in a stripped SEA
    // binary), the import rejects and we keep the default input behavior.
    const koffi = (await loadKoffi()).default;
    const kernel32 = koffi.load('kernel32.dll');
    consoleApi = {
      GetStdHandle: kernel32.func(
        'void* __stdcall GetStdHandle(int32 nStdHandle)',
      ),
      GetConsoleMode: kernel32.func(
        'int32 __stdcall GetConsoleMode(void* hConsoleHandle, _Out_ uint32_t *mode)',
      ),
      SetConsoleMode: kernel32.func(
        'int32 __stdcall SetConsoleMode(void* hConsoleHandle, int32 mode)',
      ),
    };
  } catch (e) {
    debugLogger.warn(
      'Failed to load Win32 console API via koffi; virtual terminal input will not be enabled:',
      e,
    );
  }
}

function enableVtInputOnStdin(): boolean {
  if (consoleApi === undefined) {
    return false;
  }
  try {
    const stdinHandle = consoleApi.GetStdHandle(STD_INPUT_HANDLE);
    if (stdinHandle === null || stdinHandle === undefined) {
      return false;
    }
    const modeOut: [number] = [0];
    if (consoleApi.GetConsoleMode(stdinHandle, modeOut) === 0) {
      return false;
    }
    return (
      consoleApi.SetConsoleMode(
        stdinHandle,
        modeOut[0] | ENABLE_EXTENDED_FLAGS | ENABLE_VIRTUAL_TERMINAL_INPUT,
      ) !== 0
    );
  } catch (e) {
    debugLogger.warn('Failed to enable virtual terminal input:', e);
    return false;
  }
}

/**
 * Installs a wrapper around `process.stdin.setRawMode` that re-applies
 * ENABLE_VIRTUAL_TERMINAL_INPUT on Windows after every raw-mode toggle.
 *
 * libuv's raw mode resets the console input mode to ENABLE_WINDOW_INPUT only
 * on every setRawMode(true) call, which disables VT input sequences (modified
 * arrow keys, kitty keyboard protocol, bracketed paste, SGR mouse events and
 * terminal capability query responses). Modern terminals such as Windows
 * Terminal therefore cannot deliver full keyboard input to the CLI without
 * this flag.
 *
 * Should be called once at startup, before any other code toggles raw mode.
 */
export async function installWindowsVtInputPatch(): Promise<void> {
  if (patchInstalled) {
    return;
  }
  if (process.platform !== 'win32' || !process.stdin.isTTY) {
    return;
  }
  patchInstalled = true;

  await loadConsoleModeApi();
  if (consoleApi === undefined) {
    return;
  }

  const stdin = process.stdin;
  const originalSetRawMode = stdin.setRawMode.bind(stdin);

  stdin.setRawMode = ((mode: boolean) => {
    const result = originalSetRawMode(mode);
    if (mode) {
      enableVtInputOnStdin();
    }
    return result;
  }) as typeof stdin.setRawMode;
}

/** Resets module-level state so tests can re-run the patch installation. */
export function resetWindowsVtInputForTesting(): void {
  consoleApi = undefined;
  patchInstalled = false;
}
