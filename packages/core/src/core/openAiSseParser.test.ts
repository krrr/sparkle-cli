/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { OpenAiStreamChunk } from './openAiTypes.js';
import { parseOpenAiSseStream } from './openAiSseParser.js';

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(
  body: ReadableStream<Uint8Array>,
): Promise<OpenAiStreamChunk[]> {
  const results: OpenAiStreamChunk[] = [];
  for await (const chunk of parseOpenAiSseStream(body)) {
    results.push(chunk);
  }
  return results;
}

describe('parseOpenAiSseStream', () => {
  it('parses a single data event', async () => {
    const chunks = await collect(sseStream([`data: {"id":"1"}\n\n`]));
    expect(chunks).toEqual([{ id: '1' }]);
  });

  it('parses multiple events in a single buffer', async () => {
    const chunks = await collect(
      sseStream([
        'data: {"id":"1"}\n\n',
        'data: {"id":"2"}\n\n',
        'data: {"id":"3"}\n\n',
      ]),
    );
    expect(chunks.map((c) => c.id)).toEqual(['1', '2', '3']);
  });

  it('handles CRLF line endings', async () => {
    const chunks = await collect(sseStream([`data: {"id":"1"}\r\n\r\n`]));
    expect(chunks).toEqual([{ id: '1' }]);
  });

  it('stops at the [DONE] marker', async () => {
    const chunks = await collect(
      sseStream([
        `data: {"id":"1"}\n\n`,
        `data: [DONE]\n\n`,
        `data: {"id":"2"}\n\n`,
      ]),
    );
    expect(chunks.map((c) => c.id)).toEqual(['1']);
  });

  it('handles events split across read chunks', async () => {
    const payload = 'data: {"id":"1","value":"hello world"}\n\n';
    // Split the payload into 3-byte fragments to force partial-line reads.
    const fragments: string[] = [];
    for (let i = 0; i < payload.length; i += 3) {
      fragments.push(payload.slice(i, i + 3));
    }
    const chunks = await collect(sseStream(fragments));
    expect(chunks).toEqual([{ id: '1', value: 'hello world' }]);
  });

  it('ignores comment lines and empty lines', async () => {
    const chunks = await collect(
      sseStream([`: keep-alive comment\n`, `\n`, `data: {"id":"1"}\n\n`]),
    );
    expect(chunks).toEqual([{ id: '1' }]);
  });

  it('concatenates JSON payloads split across multiple data lines', async () => {
    const chunks = await collect(
      sseStream([`data: {"id":"1","pa\n`, `data: rtial":true}\n\n`]),
    );
    expect(chunks).toEqual([{ id: '1', partial: true }]);
  });

  it('skips malformed JSON events without aborting the stream', async () => {
    const chunks = await collect(
      sseStream([`data: {not valid json\n\n`, `data: {"id":"1"}\n\n`]),
    );
    expect(chunks).toEqual([{ id: '1' }]);
  });

  it('flushes a trailing data line without a newline terminator', async () => {
    const chunks = await collect(
      sseStream([`data: {"id":"1"}\n\n`, `data: {"id":"2"}`]),
    );
    expect(chunks.map((c) => c.id)).toEqual(['1', '2']);
  });

  it('releases the reader lock after completion', async () => {
    const reader = sseStream([`data: {"id":"1"}\n\n`]).getReader();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void reader.read().then(({ done, value }) => {
          if (!done && value) {
            controller.enqueue(value);
          }
          controller.close();
        });
      },
    });
    await collect(stream);
    expect(() => reader.releaseLock()).not.toThrow();
  });
});
