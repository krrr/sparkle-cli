/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SESSION_INDEX_FILENAME,
  SESSION_INDEX_VERSION,
  buildSessionIndexEntry,
  getSessionsIndexPath,
  readSessionsIndex,
  writeSessionsIndex,
  type SessionsIndexFile,
} from './sessionIndex.js';
import { MAX_FIRST_USER_MESSAGE_LENGTH } from './chatRecordingService.js';

describe('sessionIndex', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'sparkle-cli-session-index-'),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('readSessionsIndex', () => {
    it('returns null when the index file does not exist', async () => {
      expect(await readSessionsIndex(tmpDir)).toBeNull();
    });

    it('returns null for invalid JSON', async () => {
      await fs.writeFile(getSessionsIndexPath(tmpDir), 'not json', 'utf-8');
      expect(await readSessionsIndex(tmpDir)).toBeNull();
    });

    it('returns null for an unsupported schema version', async () => {
      await fs.writeFile(
        getSessionsIndexPath(tmpDir),
        JSON.stringify({ version: 999, sessions: {} }),
        'utf-8',
      );
      expect(await readSessionsIndex(tmpDir)).toBeNull();
    });

    it('returns null for malformed entries', async () => {
      await fs.writeFile(
        getSessionsIndexPath(tmpDir),
        JSON.stringify({
          version: SESSION_INDEX_VERSION,
          sessions: 'invalid',
        }),
        'utf-8',
      );
      expect(await readSessionsIndex(tmpDir)).toBeNull();
    });

    it('round-trips a written index', async () => {
      const index: SessionsIndexFile = {
        version: SESSION_INDEX_VERSION,
        sessions: {
          'session-2024.jsonl': {
            fileName: 'session-2024.jsonl',
            size: 10,
            mtimeMs: 123,
            metadata: {
              sessionId: 'abc',
              startTime: '2024-01-01T00:00:00.000Z',
              lastUpdated: '2024-01-01T00:01:00.000Z',
              kind: 'main',
              hasResumableContent: true,
              messageCount: 2,
              userMessageCount: 1,
              firstUserMessage: 'hello',
              summary: 'a summary',
            },
          },
        },
      };
      await writeSessionsIndex(tmpDir, index);
      expect(await readSessionsIndex(tmpDir)).toEqual(index);
    });
  });

  describe('writeSessionsIndex', () => {
    it('writes atomically without leaving temp files behind', async () => {
      await writeSessionsIndex(tmpDir, {
        version: SESSION_INDEX_VERSION,
        sessions: {},
      });
      const files = await fs.readdir(tmpDir);
      expect(files).toEqual([SESSION_INDEX_FILENAME]);
    });
  });

  describe('buildSessionIndexEntry', () => {
    async function writeSessionFile(
      fileName: string,
      lines: unknown[],
    ): Promise<string> {
      const filePath = path.join(tmpDir, fileName);
      await fs.writeFile(
        filePath,
        lines.map((line) => JSON.stringify(line)).join('\n') + '\n',
        'utf-8',
      );
      return filePath;
    }

    it('extracts metadata from a resumable session', async () => {
      const filePath = await writeSessionFile('session-2024.jsonl', [
        {
          sessionId: 'abc',
          projectHash: 'hash',
          startTime: '2024-01-01T00:00:00.000Z',
          lastUpdated: '2024-01-01T00:01:00.000Z',
          kind: 'main',
        },
        {
          id: 'm1',
          timestamp: '2024-01-01T00:00:00.000Z',
          type: 'user',
          content: 'Hello',
        },
      ]);
      const stat = await fs.stat(filePath);

      const entry = await buildSessionIndexEntry(filePath, stat);

      expect(entry.fileName).toBe('session-2024.jsonl');
      expect(entry.size).toBe(stat.size);
      expect(entry.mtimeMs).toBe(stat.mtimeMs);
      expect(entry.metadata).toEqual({
        sessionId: 'abc',
        startTime: '2024-01-01T00:00:00.000Z',
        lastUpdated: '2024-01-01T00:01:00.000Z',
        kind: 'main',
        hasResumableContent: true,
        messageCount: 1,
        userMessageCount: 1,
        firstUserMessage: 'Hello',
        summary: undefined,
      });
    });

    it('stores a truncated first user message for over-long content', async () => {
      const longContent = 'a'.repeat(300);
      const filePath = await writeSessionFile('session-2024.jsonl', [
        {
          sessionId: 'abc',
          projectHash: 'hash',
          startTime: '2024-01-01T00:00:00.000Z',
          lastUpdated: '2024-01-01T00:01:00.000Z',
          kind: 'main',
        },
        {
          id: 'm1',
          timestamp: '2024-01-01T00:00:00.000Z',
          type: 'user',
          content: longContent,
        },
      ]);
      const stat = await fs.stat(filePath);

      const entry = await buildSessionIndexEntry(filePath, stat);

      expect(entry.metadata?.firstUserMessage).toBe(
        longContent.slice(0, MAX_FIRST_USER_MESSAGE_LENGTH),
      );
    });

    it('marks non-resumable (info-only) sessions as not resumable', async () => {
      const filePath = await writeSessionFile('session-2024.jsonl', [
        {
          sessionId: 'abc',
          projectHash: 'hash',
          startTime: '2024-01-01T00:00:00.000Z',
          lastUpdated: '2024-01-01T00:01:00.000Z',
        },
        {
          id: 'm1',
          timestamp: '2024-01-01T00:00:00.000Z',
          type: 'info',
          content: 'Session started',
        },
      ]);
      const stat = await fs.stat(filePath);

      const entry = await buildSessionIndexEntry(filePath, stat);

      expect(entry.metadata?.hasResumableContent).toBe(false);
      expect(entry.metadata?.messageCount).toBe(1);
      expect(entry.metadata?.firstUserMessage).toBeUndefined();
    });

    it('captures the latest summary metadata from $set updates', async () => {
      const filePath = await writeSessionFile('session-2024.jsonl', [
        {
          sessionId: 'abc',
          projectHash: 'hash',
          startTime: '2024-01-01T00:00:00.000Z',
          lastUpdated: '2024-01-01T00:01:00.000Z',
        },
        {
          id: 'm1',
          timestamp: '2024-01-01T00:00:00.000Z',
          type: 'user',
          content: 'Hello',
        },
        { $set: { lastUpdated: '2024-01-01T00:05:00.000Z', summary: 'New' } },
      ]);
      const stat = await fs.stat(filePath);

      const entry = await buildSessionIndexEntry(filePath, stat);

      expect(entry.metadata?.lastUpdated).toBe('2024-01-01T00:05:00.000Z');
      expect(entry.metadata?.summary).toBe('New');
    });

    it('returns a tombstone entry for a corrupted file', async () => {
      const filePath = path.join(tmpDir, 'session-corrupt.jsonl');
      await fs.writeFile(filePath, 'not valid json\n', 'utf-8');
      const stat = await fs.stat(filePath);

      const entry = await buildSessionIndexEntry(filePath, stat);

      expect(entry.metadata).toBeNull();
      expect(entry.size).toBe(stat.size);
      expect(entry.mtimeMs).toBe(stat.mtimeMs);
    });

    it('returns a tombstone entry when sessionId is missing', async () => {
      const filePath = await writeSessionFile('session-2024.jsonl', [
        { projectHash: 'hash' },
      ]);
      const stat = await fs.stat(filePath);

      const entry = await buildSessionIndexEntry(filePath, stat);

      expect(entry.metadata).toBeNull();
    });

    it('returns a tombstone entry for a missing file', async () => {
      const entry = await buildSessionIndexEntry(
        path.join(tmpDir, 'session-missing.jsonl'),
        { size: 0, mtimeMs: 0 },
      );

      expect(entry.metadata).toBeNull();
    });
  });
});
