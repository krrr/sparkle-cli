/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseLlmClient } from '../core/baseLlmClient.js';
import { FakeContentGenerator } from '../core/fakeContentGenerator.js';
import { Config } from '../config/config.js';
import { RetryableQuotaError } from '../utils/googleQuotaErrors.js';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  SPARKLE_MODEL_ALIAS_AUTO,
} from '../config/models.js';
import fs from 'node:fs';
import { ProviderType } from '../config/constants.js';
import type { FallbackIntent } from '../fallback/types.js';
import { LlmRole } from '../telemetry/types.js';
import type { GenerateContentResponse } from '@google/genai';

vi.mock('node:fs');

describe('Auto Routing Fallback Integration', () => {
  let config: Config;
  let fakeGenerator: FakeContentGenerator;
  let client: BaseLlmClient;

  beforeEach(() => {
    vi.useFakeTimers();
    // Mock fs to avoid real file system access
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
    } as fs.Stats);

    // Provide a valid dummy sandbox policy for any readFileSync calls for TOML files
    vi.mocked(fs.readFileSync).mockImplementation((path) => {
      if (typeof path === 'string' && path.endsWith('.toml')) {
        return `
          [modes.plan]
          network = false
          readonly = true
          approvedTools = []

          [modes.default]
          network = false
          readonly = false
          approvedTools = []

          [modes.accepting_edits]
          network = false
          readonly = false
          approvedTools = []
        `;
      }
      return ''; // Fallback for other files
    });

    fakeGenerator = new FakeContentGenerator([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should fallback to Flash after 3 tries and try 10 times for Flash in auto mode', async () => {
    // Instantiate real Config in auto mode
    config = new Config({
      sessionId: 'test-session',
      targetDir: '/test',
      debugMode: false,
      cwd: '/test',
      model: SPARKLE_MODEL_ALIAS_AUTO, // Trigger auto mode
    });

    // Force interactive mode to enable fallback handler in BaseLlmClient
    vi.spyOn(config, 'isInteractive').mockReturnValue(true);

    client = new BaseLlmClient(fakeGenerator, config, ProviderType.USE_GEMINI);

    let attemptsPro = 0;
    let attemptsFlash = 0;

    const mockGoogleApiError = {
      code: 429,
      message: 'Quota exceeded',
      details: [],
    };

    // Spy on generateContent to simulate failures
    vi.spyOn(fakeGenerator, 'generateContent').mockImplementation(
      async (params) => {
        if (params.model === DEFAULT_GEMINI_MODEL) {
          attemptsPro++;
          throw new RetryableQuotaError(
            'Quota exceeded for Pro',
            mockGoogleApiError,
            0,
          );
        } else if (params.model === DEFAULT_GEMINI_FLASH_MODEL) {
          attemptsFlash++;
          throw new RetryableQuotaError(
            'Quota exceeded for Flash',
            mockGoogleApiError,
            0,
          );
        }
        throw new Error(`Unexpected model: ${params.model}`);
      },
    );

    // Set a fallback handler that approves the switch (simulating user or auto approval)
    config.setFallbackModelHandler(
      async (failed, _fallback, _error): Promise<FallbackIntent | null> => {
        if (failed === DEFAULT_GEMINI_FLASH_MODEL) {
          return 'stop'; // Stop retrying after Flash fails
        }
        return 'retry_always'; // Trigger fallback to Flash
      },
    );

    // Call generateContent
    const promise = client.generateContent({
      modelConfigKey: { model: DEFAULT_GEMINI_MODEL, isChatModel: true },
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      abortSignal: new AbortController().signal,
      promptId: 'test-prompt',
      role: LlmRole.UTILITY_TOOL,
    });

    await Promise.all([
      expect(promise).rejects.toThrow('Quota exceeded for Flash'),
      vi.runAllTimersAsync(),
    ]);

    // Verify attempts
    expect(attemptsPro).toBe(3);
    expect(attemptsFlash).toBe(10);
  });

  it('should try 10 times and prompt user for a custom model', async () => {
    // Instantiate real Config with a custom model (single-model chain)
    const configNonAuto = new Config({
      sessionId: 'test-session',
      targetDir: '/test',
      debugMode: false,
      cwd: '/test',
      model: 'my-custom-model', // Custom model (no fallback chain)
    });

    // Force interactive mode to enable fallback handler in BaseLlmClient
    vi.spyOn(configNonAuto, 'isInteractive').mockReturnValue(true);

    const clientNonAuto = new BaseLlmClient(
      fakeGenerator,
      configNonAuto,
      ProviderType.USE_GEMINI,
    );

    let attemptsCustom = 0;

    const mockGoogleApiError = {
      code: 429,
      message: 'Quota exceeded',
      details: [],
    };

    // Spy on generateContent to simulate failures
    vi.spyOn(fakeGenerator, 'generateContent').mockImplementation(
      async (params) => {
        if (params.model === 'my-custom-model') {
          attemptsCustom++;
          throw new RetryableQuotaError(
            'Quota exceeded for custom model',
            mockGoogleApiError,
            0,
          );
        }
        throw new Error(`Unexpected model: ${params.model}`);
      },
    );

    // Set a fallback handler that returns 'stop' (simulating user stopping or failing to handle)
    const handler = vi.fn(
      async (_failed, _fallback, _error): Promise<FallbackIntent | null> =>
        'stop',
    );
    configNonAuto.setFallbackModelHandler(handler);

    const promise = clientNonAuto.generateContent({
      modelConfigKey: { model: 'my-custom-model', isChatModel: true },
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      abortSignal: new AbortController().signal,
      promptId: 'test-prompt',
      role: LlmRole.UTILITY_TOOL,
      maxAttempts: 10,
    });

    await Promise.all([
      expect(promise).rejects.toThrow('Quota exceeded for custom model'),
      vi.runAllTimersAsync(),
    ]);

    // Verify attempts (should default to 10)
    expect(attemptsCustom).toBe(10);

    // Verify handler was called once after 10 attempts to prompt user
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      'my-custom-model',
      'my-custom-model',
      expect.any(RetryableQuotaError),
    );
  });

  it('should retry Pro on next turn after successful fallback to Flash', async () => {
    // Instantiate real Config in auto mode
    config = new Config({
      sessionId: 'test-session',
      targetDir: '/test',
      debugMode: false,
      cwd: '/test',
      model: SPARKLE_MODEL_ALIAS_AUTO, // Trigger auto mode
    });

    // Force interactive mode to enable fallback handler in BaseLlmClient
    vi.spyOn(config, 'isInteractive').mockReturnValue(true);

    client = new BaseLlmClient(fakeGenerator, config, ProviderType.USE_GEMINI);

    let attemptsPro = 0;
    let attemptsFlash = 0;

    const mockGoogleApiError = {
      code: 429,
      message: 'Quota exceeded',
      details: [],
    };

    // Turn 1: Pro fails, Flash succeeds
    vi.spyOn(fakeGenerator, 'generateContent').mockImplementation(
      async (params) => {
        if (params.model === DEFAULT_GEMINI_MODEL) {
          attemptsPro++;
          throw new RetryableQuotaError(
            'Quota exceeded for Pro',
            mockGoogleApiError,
            0,
          );
        } else if (params.model === DEFAULT_GEMINI_FLASH_MODEL) {
          attemptsFlash++;
          return {
            candidates: [
              {
                content: { role: 'model', parts: [{ text: 'Flash success' }] },
              },
            ],
          } as unknown as GenerateContentResponse;
        }
        throw new Error(`Unexpected model: ${params.model}`);
      },
    );

    config.setFallbackModelHandler(
      async (_failed, _fallback, _error): Promise<FallbackIntent | null> =>
        'retry_always', // Approve switch to Flash
    );

    // Call generateContent for Turn 1
    const promise1 = client.generateContent({
      modelConfigKey: { model: DEFAULT_GEMINI_MODEL, isChatModel: true },
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      abortSignal: new AbortController().signal,
      promptId: 'test-prompt-1',
      role: LlmRole.UTILITY_TOOL,
    });

    await vi.runAllTimersAsync();
    const result1 = await promise1;

    expect(result1.candidates?.[0]?.content?.parts?.[0]?.text).toBe(
      'Flash success',
    );
    expect(attemptsPro).toBe(3);
    expect(attemptsFlash).toBe(1);

    // Simulate start of next turn
    config.getModelAvailabilityService().resetTurn();

    // Turn 2: Pro should be attempted again!
    // Let's make it succeed this time to verify it works!
    vi.spyOn(fakeGenerator, 'generateContent').mockImplementation(
      async (params) => {
        if (params.model === DEFAULT_GEMINI_MODEL) {
          return {
            candidates: [
              { content: { role: 'model', parts: [{ text: 'Pro success' }] } },
            ],
          } as unknown as GenerateContentResponse;
        }
        throw new Error(`Unexpected model: ${params.model}`);
      },
    );

    const promise2 = client.generateContent({
      modelConfigKey: { model: DEFAULT_GEMINI_MODEL, isChatModel: true }, // Request Pro again
      contents: [{ role: 'user', parts: [{ text: 'hello again' }] }],
      abortSignal: new AbortController().signal,
      promptId: 'test-prompt-2',
      role: LlmRole.UTILITY_TOOL,
    });

    const result2 = await promise2;
    expect(result2.candidates?.[0]?.content?.parts?.[0]?.text).toBe(
      'Pro success',
    );
  });

  it('should rotate session ID on fallback and retry successfully with the Flash model', async () => {
    const originalSessionId = 'test-session-rotate-id';
    config = new Config({
      sessionId: originalSessionId,
      targetDir: '/test',
      debugMode: false,
      cwd: '/test',
      model: SPARKLE_MODEL_ALIAS_AUTO,
    });

    vi.spyOn(config, 'isInteractive').mockReturnValue(true);

    client = new BaseLlmClient(fakeGenerator, config, ProviderType.USE_GEMINI);

    let attemptsPro = 0;
    let attemptsFlash = 0;

    const mockGoogleApiError = {
      code: 429,
      message:
        'Automatically switching from gemini-2.5-pro to gemini-2.5-flash for faster responses for the remainder of this session. Possible reasons for this are...',
      details: [],
    };

    vi.spyOn(fakeGenerator, 'generateContent').mockImplementation(
      async (params) => {
        if (params.model === DEFAULT_GEMINI_MODEL) {
          attemptsPro++;
          throw new RetryableQuotaError(
            'Quota exceeded for Pro',
            mockGoogleApiError,
            0,
          );
        } else if (params.model === DEFAULT_GEMINI_FLASH_MODEL) {
          attemptsFlash++;
          return {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [{ text: 'Flash success after rotation' }],
                },
              },
            ],
          } as unknown as GenerateContentResponse;
        }
        throw new Error(`Unexpected model: ${params.model}`);
      },
    );

    config.setFallbackModelHandler(
      async (_failed, _fallback, _error): Promise<FallbackIntent | null> =>
        'retry_always', // Approve switch to Flash
    );

    const promise = client.generateContent({
      modelConfigKey: { model: DEFAULT_GEMINI_MODEL, isChatModel: true },
      contents: [{ role: 'user', parts: [{ text: 'test query' }] }],
      abortSignal: new AbortController().signal,
      promptId: 'test-prompt',
      role: LlmRole.UTILITY_TOOL,
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    // Verify it resolved to Flash success instead of failing with Please submit a new query
    expect(result.candidates?.[0]?.content?.parts?.[0]?.text).toBe(
      'Flash success after rotation',
    );
    expect(attemptsPro).toBe(3);
    expect(attemptsFlash).toBe(1);

    // Verify session ID has been rotated
    expect(config.getSessionId()).not.toBe(originalSessionId);
    expect(config.getSessionId()).toBeDefined();
  });
});
