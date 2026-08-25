/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type { BaseLlmClient } from '../core/baseLlmClient.js';
import {
  DEFAULT_FAST_ACK_MODEL_CONFIG_KEY,
  generateFastAckText,
  truncateFastAckInput,
  generateSteeringAckMessage,
  type PendingHintEntry,
  formatPendingHintForDelivery,
  formatPendingHintsForDelivery,
} from './fastAckHelper.js';
import { LlmRole } from 'src/telemetry/llmRole.js';

describe('truncateFastAckInput', () => {
  it('returns input as-is when below limit', () => {
    expect(truncateFastAckInput('hello', 10)).toBe('hello');
  });

  it('truncates and appends suffix when above limit', () => {
    const input = 'abcdefghijklmnopqrstuvwxyz';
    const result = truncateFastAckInput(input, 20);
    // grapheme count is 20
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: 'grapheme',
    });
    expect(Array.from(segmenter.segment(result)).length).toBe(20);
    expect(result).toContain('...[truncated]');
  });

  it('is grapheme aware', () => {
    const input = '👨‍👩‍👧‍👦'.repeat(10); // 10 family emojis
    const result = truncateFastAckInput(input, 5);
    // family emoji is 1 grapheme
    expect(result).toBe('👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦');
  });
});

describe('generateFastAckText', () => {
  const abortSignal = new AbortController().signal;

  it('uses the default fast-ack-helper model config and returns response text', async () => {
    const llmClient = {
      generateContent: vi.fn().mockResolvedValue({
        candidates: [
          { content: { parts: [{ text: '  Got it. Skipping #2.  ' }] } },
        ],
      }),
    } as unknown as BaseLlmClient;

    const result = await generateFastAckText(llmClient, {
      instruction: 'Write a short acknowledgement sentence.',
      input: 'skip #2',
      fallbackText: 'Got it.',
      abortSignal,
      promptId: 'test',
    });

    expect(result).toBe('Got it. Skipping #2.');
    expect(llmClient.generateContent).toHaveBeenCalledWith({
      modelConfigKey: DEFAULT_FAST_ACK_MODEL_CONFIG_KEY,
      contents: expect.any(Array),
      abortSignal,
      promptId: 'test',
      maxAttempts: 1,
      role: LlmRole.UTILITY_FAST_ACK_HELPER,
    });
  });

  it('returns fallback text when response text is empty', async () => {
    const llmClient = {
      generateContent: vi.fn().mockResolvedValue({}),
    } as unknown as BaseLlmClient;

    const result = await generateFastAckText(llmClient, {
      instruction: 'Return one sentence.',
      input: 'cancel task 2',
      fallbackText: 'Understood. Cancelling task 2.',
      abortSignal,
      promptId: 'test',
    });

    expect(result).toBe('Understood. Cancelling task 2.');
  });

  it('returns fallback text when generation throws', async () => {
    const llmClient = {
      generateContent: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as BaseLlmClient;

    const result = await generateFastAckText(llmClient, {
      instruction: 'Return one sentence.',
      input: 'cancel task 2',
      fallbackText: 'Understood.',
      abortSignal,
      promptId: 'test',
    });

    expect(result).toBe('Understood.');
  });
});

describe('generateSteeringAckMessage', () => {
  it('returns a shortened acknowledgement using fast-ack-helper', async () => {
    const llmClient = {
      generateContent: vi.fn().mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: 'Got it. I will focus on the tests now.' }],
            },
          },
        ],
      }),
    } as unknown as BaseLlmClient;

    const result = await generateSteeringAckMessage(
      llmClient,
      'focus on tests',
    );
    expect(result).toBe('Got it. I will focus on the tests now.');
  });

  it('returns a fallback message if the model fails', async () => {
    const llmClient = {
      generateContent: vi.fn().mockRejectedValue(new Error('timeout')),
    } as unknown as BaseLlmClient;

    const result = await generateSteeringAckMessage(
      llmClient,
      'a very long hint that should be truncated in the fallback message if it was longer but it is not',
    );
    expect(result).toContain('Understood. a very long hint');
  });

  it('returns a very simple fallback if hint is empty', async () => {
    const llmClient = {
      generateContent: vi.fn().mockRejectedValue(new Error('error')),
    } as unknown as BaseLlmClient;

    const result = await generateSteeringAckMessage(llmClient, '   ');
    expect(result).toBe('Understood. Adjusting the plan.');
  });
});

describe('pendingHintFormatting', () => {
  it('formats user_steering entries with the steering prompt wrapper', () => {
    const entry: PendingHintEntry = {
      text: 'please also update the docs',
      source: 'user_steering',
    };
    const formatted = formatPendingHintForDelivery(entry);
    expect(formatted).toContain('User steering update');
    expect(formatted).toContain('please also update the docs');
  });

  it('formats background_completion entries with the data-safety wrapper', () => {
    const entry: PendingHintEntry = {
      text: '[Background command npm test (PID: 42) completed successfully]',
      source: 'background_completion',
    };
    const formatted = formatPendingHintForDelivery(entry);
    expect(formatted).toContain('<background_output>');
    expect(formatted).toContain(
      '[Background command npm test (PID: 42) completed successfully]',
    );
    // Completions must NOT be framed as plan-steering instructions.
    expect(formatted).not.toContain('User steering update');
  });

  it('joins mixed-source batches with blank lines, each formatted per source', () => {
    const entries: PendingHintEntry[] = [
      { text: 'steer left', source: 'user_steering' },
      { text: 'task A finished', source: 'background_completion' },
    ];
    const formatted = formatPendingHintsForDelivery(entries);
    expect(formatted).toContain('User steering update');
    expect(formatted).toContain('<background_output>');
    expect(formatted).toContain('\n\n');
  });
});
