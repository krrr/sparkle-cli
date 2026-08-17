/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import os from 'node:os';
import { vi } from 'vitest';
import {
  RELAUNCH_EXIT_CODE,
  relaunchApp,
  _resetRelaunchStateForTesting,
  isStandardSea,
  getScriptArgs,
  isSeaEnvironment,
  getSpawnConfig,
  getCompileCacheDir,
  type ProcessWithSea,
} from './processUtils.js';
import * as cleanup from './cleanup.js';
import * as handleAutoUpdate from './handleAutoUpdate.js';

vi.mock('./handleAutoUpdate.js', () => ({
  waitForUpdateCompletion: vi.fn().mockResolvedValue(undefined),
}));

describe('processUtils', () => {
  const processExit = vi
    .spyOn(process, 'exit')
    .mockReturnValue(undefined as never);
  const runExitCleanup = vi.spyOn(cleanup, 'runExitCleanup');

  beforeEach(() => {
    _resetRelaunchStateForTesting();
  });

  afterEach(() => vi.clearAllMocks());

  it('should wait for updates, run cleanup, and exit with the relaunch code', async () => {
    await relaunchApp();
    expect(handleAutoUpdate.waitForUpdateCompletion).toHaveBeenCalledTimes(1);
    expect(runExitCleanup).toHaveBeenCalledTimes(1);
    expect(processExit).toHaveBeenCalledWith(RELAUNCH_EXIT_CODE);
  });
});

describe('SEA handling utilities', () => {
  const originalArgv = process.argv;
  const originalExecArgv = process.execArgv;
  const originalExecPath = process.execPath;
  const originalIsSea = (process as ProcessWithSea).isSea;

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_OPTIONS', '');
    process.argv = [...originalArgv];
    process.execArgv = [...originalExecArgv];
    process.execPath = '/fake/exec/path';
    delete (process as ProcessWithSea).isSea;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.argv = originalArgv;
    process.execArgv = originalExecArgv;
    process.execPath = originalExecPath;
    if (originalIsSea) {
      (process as ProcessWithSea).isSea = originalIsSea;
    } else {
      delete (process as ProcessWithSea).isSea;
    }
  });

  describe('isStandardSea', () => {
    it('returns false if argv[0] === argv[1]', () => {
      process.argv = ['/bin/gemini', '/bin/gemini', 'my-command'];
      vi.stubEnv('IS_BINARY', 'true');
      expect(isStandardSea()).toBe(false);
    });

    it('returns true if IS_BINARY is true and argv[0] !== argv[1]', () => {
      process.argv = ['/bin/gemini', 'my-command'];
      vi.stubEnv('IS_BINARY', 'true');
      expect(isStandardSea()).toBe(true);
    });

    it('returns true if process.isSea() is true and argv[0] !== argv[1]', () => {
      process.argv = ['/bin/gemini', 'my-command'];
      (process as ProcessWithSea).isSea = () => true;
      expect(isStandardSea()).toBe(true);
    });

    it('returns false in standard node environment', () => {
      process.argv = ['/bin/node', '/path/to/script.js', 'my-command'];
      expect(isStandardSea()).toBe(false);
    });
  });

  describe('getScriptArgs', () => {
    it('slices from index 1 if isStandardSea is true', () => {
      process.argv = ['/bin/gemini', 'my-command', '--flag'];
      vi.stubEnv('IS_BINARY', 'true');
      expect(getScriptArgs()).toEqual(['my-command', '--flag']);
    });

    it('slices from index 2 if isStandardSea is false (relaunch SEA or standard node)', () => {
      // Relaunch SEA
      process.argv = ['/bin/gemini', '/bin/gemini', 'my-command', '--flag'];
      vi.stubEnv('IS_BINARY', 'true');
      expect(getScriptArgs()).toEqual(['my-command', '--flag']);

      // Standard node
      process.argv = ['/bin/node', '/path/to/script.js', 'my-command'];
      vi.stubEnv('IS_BINARY', '');
      expect(getScriptArgs()).toEqual(['my-command']);
    });
  });

  describe('isSeaEnvironment', () => {
    it('returns true if IS_BINARY is true', () => {
      vi.stubEnv('IS_BINARY', 'true');
      expect(isSeaEnvironment()).toBe(true);
    });

    it('returns true if process.isSea() is true', () => {
      (process as ProcessWithSea).isSea = () => true;
      expect(isSeaEnvironment()).toBe(true);
    });

    it('returns true if argv[0] === argv[1]', () => {
      process.argv = ['/bin/gemini', '/bin/gemini'];
      expect(isSeaEnvironment()).toBe(true);
    });

    it('returns false otherwise', () => {
      process.argv = ['/bin/node', '/path/to/script.js'];
      expect(isSeaEnvironment()).toBe(false);
    });
  });

  describe('getSpawnConfig', () => {
    it('handles standard node mode', () => {
      process.argv = ['/bin/node', '/path/to/script.js', 'my-command'];
      process.execArgv = ['--inspect'];
      process.execPath = '/bin/node';

      const config = getSpawnConfig(
        ['--max-old-space-size=8192'],
        ['my-command'],
      );

      expect(config.spawnArgs).toEqual([
        '--inspect',
        '--max-old-space-size=8192',
        '/path/to/script.js',
        'my-command',
      ]);
      expect(config.env['SPARKLE_CLI_NO_RELAUNCH']).toBe('true');
      expect(config.env['NODE_OPTIONS']).toBeFalsy();
    });

    it('handles SEA binary mode with new nodeArgs', () => {
      vi.stubEnv('IS_BINARY', 'true');
      vi.stubEnv('NODE_OPTIONS', '--existing-flag');
      process.argv = ['/bin/gemini', 'my-command'];
      process.execArgv = ['--inspect']; // Should not be duplicated in NODE_OPTIONS
      process.execPath = '/bin/gemini';

      const config = getSpawnConfig(
        ['--max-old-space-size=8192'],
        ['my-command'],
      );

      expect(config.spawnArgs).toEqual([
        '/bin/gemini', // explicitly uses execPath as placeholder
        'my-command',
      ]);
      expect(config.env['NODE_OPTIONS']).toBe(
        '--existing-flag --max-old-space-size=8192',
      );
      expect(config.env['SPARKLE_CLI_NO_RELAUNCH']).toBe('true');
    });

    it('throws error for complex nodeArgs in SEA mode', () => {
      vi.stubEnv('IS_BINARY', 'true');

      expect(() => {
        getSpawnConfig(['--title "My App"'], []);
      }).toThrow(
        'Unsupported node argument for SEA relaunch: --title "My App". Complex escaping is not supported.',
      );

      expect(() => {
        getSpawnConfig(['--title=A\\B'], []);
      }).toThrow();
    });
  });

  describe('getCompileCacheDir', () => {
    beforeEach(() => {
      vi.unstubAllEnvs();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns default cache directory under ~/.sparkle/cache', () => {
      vi.stubEnv('SPARKLE_CLI_HOME', '');
      vi.stubEnv('NODE_COMPILE_CACHE', '');
      const expected = path.join(os.homedir(), '.sparkle', 'cache', 'v8');
      expect(getCompileCacheDir()).toBe(expected);
    });

    it('respects SPARKLE_CLI_HOME for default cache directory', () => {
      vi.stubEnv('SPARKLE_CLI_HOME', '/custom/sparkle/home');
      vi.stubEnv('NODE_COMPILE_CACHE', '');
      const expected = path.join('/custom/sparkle/home', 'cache', 'v8');
      expect(getCompileCacheDir()).toBe(expected);
    });

    it('returns custom path when NODE_COMPILE_CACHE is a directory path', () => {
      vi.stubEnv('NODE_COMPILE_CACHE', '/my/custom/cache/dir');
      expect(getCompileCacheDir()).toBe('/my/custom/cache/dir');
    });

    it('returns undefined when NODE_COMPILE_CACHE is 0, false, or off', () => {
      vi.stubEnv('NODE_COMPILE_CACHE', '0');
      expect(getCompileCacheDir()).toBeUndefined();

      vi.stubEnv('NODE_COMPILE_CACHE', 'false');
      expect(getCompileCacheDir()).toBeUndefined();

      vi.stubEnv('NODE_COMPILE_CACHE', 'off');
      expect(getCompileCacheDir()).toBeUndefined();
    });

    it('returns default path when NODE_COMPILE_CACHE is 1 or true', () => {
      vi.stubEnv('SPARKLE_CLI_HOME', '/custom/home');
      vi.stubEnv('NODE_COMPILE_CACHE', '1');
      expect(getCompileCacheDir()).toBe(
        path.join('/custom/home', 'cache', 'v8'),
      );

      vi.stubEnv('NODE_COMPILE_CACHE', 'true');
      expect(getCompileCacheDir()).toBe(
        path.join('/custom/home', 'cache', 'v8'),
      );
    });
  });
});
