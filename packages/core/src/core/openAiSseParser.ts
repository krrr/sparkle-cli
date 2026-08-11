/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OpenAiStreamChunk } from './openAiTypes.js';

/**
 * Parses an OpenAI-compatible SSE (Server-Sent Events) response body into a
 * sequence of `OpenAiStreamChunk` objects.
 *
 * Handles:
 * - `data: {...}\n\n` event framing (with optional `\r` line endings).
 * - The `data: [DONE]` end-of-stream marker.
 * - JSON payloads split across multiple `data:` lines (some non-OpenAI
 *   compatible providers fragment the payload arbitrarily).
 * - Comment lines (starting with `:`) and empty lines.
 *
 * Malformed JSON events are skipped rather than aborting the stream, matching
 * the resilience of common OpenAI client SDKs.
 *
 * @param body The HTTP response body stream.
 */
export async function* parseOpenAiSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<OpenAiStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let pendingData = '';

  const processDataLine = function* (
    data: string,
  ): Generator<OpenAiStreamChunk> {
    if (data === '[DONE]' || data === '') {
      return;
    }
    const combined = pendingData + data;
    try {
      const parsed = JSON.parse(combined) as unknown;
      pendingData = '';
      if (parsed && typeof parsed === 'object') {
        yield parsed as OpenAiStreamChunk;
      }
      return;
    } catch {
      // The combined payload is not complete JSON yet. Check whether the new
      // line alone is valid: if so, the pending data was malformed garbage and
      // is discarded rather than poisoning the rest of the stream.
      try {
        const parsedAlone = JSON.parse(data) as unknown;
        pendingData = '';
        if (parsedAlone && typeof parsedAlone === 'object') {
          yield parsedAlone as OpenAiStreamChunk;
        }
      } catch {
        // Both the combined payload and the line alone are incomplete JSON:
        // keep accumulating across data lines.
        pendingData = combined;
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line === '' || line.startsWith(':')) {
          continue;
        }
        if (!line.startsWith('data:')) {
          continue;
        }
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          return;
        }
        yield* processDataLine(data);
      }
    }

    // Flush any trailing data line that was not terminated by a newline.
    const trailing = buffer.trim();
    if (trailing.startsWith('data:')) {
      const data = trailing.slice(5).trim();
      if (data !== '[DONE]') {
        yield* processDataLine(data);
      }
    }
    // A trailing non-newline-terminated partial payload is intentionally
    // dropped: it is malformed and cannot be completed.
  } finally {
    reader.releaseLock();
  }
}
