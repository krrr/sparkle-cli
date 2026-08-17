/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * IMPORTANT ARCHITECTURAL CONSTRAINT:
 *
 * This file is directly imported by `packages/cli/index.ts` (the application's root entry point).
 * `index.ts` relies on a lightweight "Phase 0" bootloader pattern to initialize V8 compile cache
 * and configure memory/environment BEFORE any heavy application chunks are parsed or compiled.
 *
 * DO NOT add top-level static imports of heavy application modules (e.g. `sparkle-cli-core`,
 * `./cleanup.js`, UI components, or core utilities) to this file.
 *
 * Doing so will cause `esbuild` to statically pull the entire multi-megabyte core dependency graph
 * into the root bundle entry (`bundle/sparkle.js`), which breaks the lightweight parent process
 * and prevents V8 compile cache from taking effect on startup.
 *
 * - Allowed at top level: Node.js built-in modules (`node:*`) and TypeScript type-only imports (`import type { ... }`).
 * - For heavy runtime operations (e.g. `relaunchApp`): Use dynamic `await import(...)` inside the function.
 */

import path from 'node:path';
import os from 'node:os';

/**
 * Returns the directory used to store compiled bytecode cache.
 * Defaults to `<SPARKLE_CLI_HOME or ~/.sparkle>/cache/v8`.
 * Can be overridden or disabled by the NODE_COMPILE_CACHE environment variable.
 */
export function getCompileCacheDir(): string | undefined {
  const envCache = process.env['NODE_COMPILE_CACHE'];
  if (envCache === '0' || envCache === 'false' || envCache === 'off') {
    return undefined;
  }
  if (envCache && envCache !== '1' && envCache !== 'true') {
    return envCache;
  }
  const baseDir =
    process.env['SPARKLE_CLI_HOME'] || path.join(os.homedir(), '.sparkle');
  return path.join(baseDir, 'cache', 'v8');
}

/**
 * Exit code used to signal that the CLI should be relaunched.
 */
export const RELAUNCH_EXIT_CODE = 199;

/**
 * Exits the process with a special code to signal that the parent process should relaunch it.
 */
let isRelaunching = false;

/** @internal only for testing */
export function _resetRelaunchStateForTesting(): void {
  isRelaunching = false;
}

export async function relaunchApp(): Promise<void> {
  if (isRelaunching) return;
  isRelaunching = true;
  const [{ waitForUpdateCompletion }, { runExitCleanup }] = await Promise.all([
    import('./handleAutoUpdate.js'),
    import('./cleanup.js'),
  ]);
  await waitForUpdateCompletion();
  await runExitCleanup();
  process.exit(RELAUNCH_EXIT_CODE);
}

export interface ProcessWithSea extends NodeJS.Process {
  isSea?: () => boolean;
}

/**
 * Determines whether the current process is a "standard" SEA (Single Executable Application)
 * where the user arguments start at index 1 instead of index 2.
 * A relaunched SEA child will have process.argv[0] === process.argv[1] (because we inject execPath),
 * so it will return false here and correctly slice from index 2.
 */
export function isStandardSea(): boolean {
  return (
    process.argv[0] !== process.argv[1] &&
    (process.env['IS_BINARY'] === 'true' ||
      (process as ProcessWithSea).isSea?.() === true)
  );
}

/**
 * Extracts the user-provided script arguments from process.argv,
 * accounting for the differences in SEA execution modes.
 */
export function getScriptArgs(): string[] {
  return process.argv.slice(isStandardSea() ? 1 : 2);
}

/**
 * Determines if the current process is running in any SEA environment
 * (either the initial launch or a relaunched child).
 */
export function isSeaEnvironment(): boolean {
  return (
    process.env['IS_BINARY'] === 'true' ||
    (process as ProcessWithSea).isSea?.() === true ||
    process.argv[0] === process.argv[1]
  );
}

/**
 * Constructs the arguments and environment for spawning a child process during relaunch.
 * Handles differences between standard Node and SEA binary modes.
 */
export function getSpawnConfig(
  nodeArgs: string[],
  scriptArgs: string[],
): {
  spawnArgs: string[];
  env: NodeJS.ProcessEnv;
} {
  const isBinary = isSeaEnvironment();
  const cacheDir = getCompileCacheDir();
  const newEnv: NodeJS.ProcessEnv = {
    ...process.env,
    SPARKLE_CLI_NO_RELAUNCH: 'true',
    ...(cacheDir ? { NODE_COMPILE_CACHE: cacheDir } : {}),
  };

  const finalSpawnArgs: string[] = [];

  if (isBinary) {
    // In SEA mode, Node flags must be passed via NODE_OPTIONS, as the binary
    // passes all CLI arguments directly to the application.
    // We only need to append the *new* nodeArgs (e.g., memory flags).
    // Existing execArgv are inherited via the environment or baked into the binary.
    if (nodeArgs.length > 0) {
      for (const arg of nodeArgs) {
        if (/[\s"'\\]/.test(arg)) {
          throw new Error(
            `Unsupported node argument for SEA relaunch: ${arg}. Complex escaping is not supported.`,
          );
        }
      }
      const existingNodeOptions = process.env['NODE_OPTIONS'] || '';
      // nodeArgs in our codebase are simple flags like --max-old-space-size=X
      // that do not contain spaces and do not require complex escaping.
      newEnv['NODE_OPTIONS'] =
        `${existingNodeOptions} ${nodeArgs.join(' ')}`.trim();
    }
    // Binary is its own entry point. To maintain the [node, script, ...args]
    // structure expected by the application (which uses slice(2)),
    // we must provide a placeholder for the script path.
    // We explicitly use process.execPath to break the cycle and prevent
    // compounding argument duplication on subsequent relaunches.
    finalSpawnArgs.push(process.execPath, ...scriptArgs);
  } else {
    // Standard Node mode: pass all flags via command line.
    finalSpawnArgs.push(
      ...process.execArgv,
      ...nodeArgs,
      process.argv[1],
      ...scriptArgs,
    );
  }

  return {
    spawnArgs: finalSpawnArgs,
    env: newEnv,
  };
}
