/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseBooleanEnvFlag, resolveTelemetrySettings } from './config.js';

describe('telemetry/config helpers', () => {
  describe('parseBooleanEnvFlag', () => {
    it('returns undefined for undefined', () => {
      expect(parseBooleanEnvFlag(undefined)).toBeUndefined();
    });

    it('parses true values', () => {
      expect(parseBooleanEnvFlag('true')).toBe(true);
      expect(parseBooleanEnvFlag('1')).toBe(true);
    });

    it('parses false/other values as false', () => {
      expect(parseBooleanEnvFlag('false')).toBe(false);
      expect(parseBooleanEnvFlag('0')).toBe(false);
      expect(parseBooleanEnvFlag('TRUE')).toBe(false);
      expect(parseBooleanEnvFlag('random')).toBe(false);
      expect(parseBooleanEnvFlag('')).toBe(false);
    });
  });

  describe('resolveTelemetrySettings', () => {
    it('falls back to settings when no argv/env provided', async () => {
      const settings = {
        enabled: false,
        traces: true,
        logPrompts: false,
        outfile: 'settings.log',
      };
      const resolved = await resolveTelemetrySettings({ settings });
      expect(resolved).toEqual(settings);
    });

    it('uses env over settings and argv over env', async () => {
      const settings = {
        enabled: false,
        logPrompts: false,
        outfile: 'settings.log',
      };
      const env = {
        GEMINI_TELEMETRY_ENABLED: '1',
        GEMINI_TELEMETRY_LOG_PROMPTS: 'true',
        GEMINI_TELEMETRY_OUTFILE: 'env.log',
      } as Record<string, string>;
      const argv = {
        telemetry: false,
        telemetryLogPrompts: false,
        telemetryOutfile: 'argv.log',
      };

      const resolvedEnv = await resolveTelemetrySettings({ env, settings });
      expect(resolvedEnv).toEqual({
        enabled: true,
        logPrompts: true,
        outfile: 'env.log',
      });

      const resolvedArgv = await resolveTelemetrySettings({
        argv,
        env,
        settings,
      });
      expect(resolvedArgv).toEqual({
        enabled: false,
        logPrompts: false,
        outfile: 'argv.log',
      });
    });

    it('resolves traces from env over settings', async () => {
      const settings = { traces: false };
      const resolved = await resolveTelemetrySettings({ settings });
      expect(resolved.traces).toBe(false);

      const env = { GEMINI_TELEMETRY_TRACES_ENABLED: 'true' };
      const resolvedEnv = await resolveTelemetrySettings({ env, settings });
      expect(resolvedEnv.traces).toBe(true);
    });

    it('returns undefined fields when nothing is provided', async () => {
      const resolved = await resolveTelemetrySettings({});
      expect(resolved).toEqual({
        enabled: undefined,
        traces: undefined,
        logPrompts: undefined,
        outfile: undefined,
      });
    });
  });
});
