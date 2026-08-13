/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Config } from '../config/config.js';
import {
  initializeTelemetry,
  shutdownTelemetry,
  bufferTelemetryEvent,
} from './sdk.js';
import { NodeSDK } from '@opentelemetry/sdk-node';

import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('@opentelemetry/sdk-node');
vi.mock('node:fs', () => ({
  createWriteStream: vi.fn(() => ({
    write: vi.fn(),
    end: vi.fn(),
  })),
}));
vi.mock('../utils/debugLogger.js', () => ({
  debugLogger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Telemetry SDK', () => {
  let mockConfig: Config;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = {
      getTelemetryEnabled: () => true,
      getTelemetryOutfile: () => undefined,
      getDebugMode: () => false,
      getSessionId: () => 'test-session',
      isInteractive: () => false,
      getExperiments: () => undefined,
      getExperimentsAsync: async () => undefined,
      getContentGeneratorConfig: () => undefined,
    } as unknown as Config;
  });

  afterEach(async () => {
    await shutdownTelemetry(mockConfig);
  });

  it('should use file exporters when telemetryOutfile is set', async () => {
    vi.spyOn(mockConfig, 'getTelemetryOutfile').mockReturnValue(
      path.join(os.tmpdir(), 'test.log'),
    );
    await initializeTelemetry(mockConfig);

    expect(NodeSDK.prototype.start).toHaveBeenCalled();
  });

  it('should fall back to console exporters when no telemetryOutfile is set', async () => {
    await initializeTelemetry(mockConfig);

    expect(NodeSDK.prototype.start).toHaveBeenCalled();
  });

  describe('bufferTelemetryEvent', () => {
    it('should execute immediately if SDK is initialized', async () => {
      await initializeTelemetry(mockConfig);
      const callback = vi.fn();
      bufferTelemetryEvent(callback);
      expect(callback).toHaveBeenCalled();
    });

    it('should buffer if SDK is not initialized, and flush on initialization', async () => {
      const callback = vi.fn();
      bufferTelemetryEvent(callback);
      expect(callback).not.toHaveBeenCalled();

      await initializeTelemetry(mockConfig);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(callback).toHaveBeenCalled();
    });
  });
});
