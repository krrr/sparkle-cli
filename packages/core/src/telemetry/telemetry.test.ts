/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initializeTelemetry,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
} from './sdk.js';
import { Config } from '../config/config.js';

vi.mock('../config/config.js');

describe('telemetry', () => {
  let mockConfig: Config;

  beforeEach(() => {
    vi.resetAllMocks();

    mockConfig = new Config({
      sessionId: 'test-session-id',
      model: 'test-model',
      targetDir: '/test/dir',
      debugMode: false,
      cwd: '/test/dir',
    });
    vi.spyOn(mockConfig, 'getTelemetryEnabled').mockReturnValue(true);
    vi.spyOn(mockConfig, 'getSessionId').mockReturnValue('test-session-id');
  });

  afterEach(async () => {
    // Ensure we shut down telemetry even if a test fails.
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry(mockConfig);
    }
  });

  it('should initialize the telemetry service', async () => {
    await initializeTelemetry(mockConfig);
    expect(isTelemetrySdkInitialized()).toBe(true);
  });

  it('should shutdown the telemetry service', async () => {
    await initializeTelemetry(mockConfig);
    expect(isTelemetrySdkInitialized()).toBe(true);
    await shutdownTelemetry(mockConfig);
    expect(isTelemetrySdkInitialized()).toBe(false);
  });
});
