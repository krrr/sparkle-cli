/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TelemetrySettings } from '../config/config.js';

/**
 * Parse a boolean environment flag. Accepts 'true'/'1' as true.
 */
export function parseBooleanEnvFlag(
  value: string | undefined,
): boolean | undefined {
  if (value === undefined) return undefined;
  return value === 'true' || value === '1';
}

export interface TelemetryArgOverrides {
  telemetry?: boolean;
  telemetryLogPrompts?: boolean;
  telemetryOutfile?: string;
}

/**
 * Build TelemetrySettings by resolving from argv (highest), env, then settings.
 */
export async function resolveTelemetrySettings(options: {
  argv?: TelemetryArgOverrides;
  env?: Record<string, string | undefined>;
  settings?: TelemetrySettings;
}): Promise<TelemetrySettings> {
  const argv = options.argv ?? {};
  const env = options.env ?? {};
  const settings = options.settings ?? {};

  const enabled =
    argv.telemetry ??
    parseBooleanEnvFlag(env['GEMINI_TELEMETRY_ENABLED']) ??
    settings.enabled;

  const traces =
    parseBooleanEnvFlag(env['GEMINI_TELEMETRY_TRACES_ENABLED']) ??
    settings.traces;

  const logPrompts =
    argv.telemetryLogPrompts ??
    parseBooleanEnvFlag(env['GEMINI_TELEMETRY_LOG_PROMPTS']) ??
    settings.logPrompts;

  const outfile =
    argv.telemetryOutfile ??
    env['GEMINI_TELEMETRY_OUTFILE'] ??
    settings.outfile;

  return {
    enabled,
    traces,
    logPrompts,
    outfile,
  };
}
