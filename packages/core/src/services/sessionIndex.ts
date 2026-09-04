/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import path from 'node:path';
import { loadConversationRecord } from './chatRecordingService.js';

/**
 * Name of the single shared session-list metadata index within a chats dir.
 *
 * The filename deliberately does not start with `SESSION_FILE_PREFIX` and is
 * not a `.jsonl` file so session-discovery filters never mistake it for a
 * session.
 */
export const SESSION_INDEX_FILENAME = '.sessions-index.json';

/** Schema version of the index file. Bump when the entry shape changes. */
export const SESSION_INDEX_VERSION = 1;

/**
 * Minimal session metadata needed to render the session list, extracted via
 * `loadConversationRecord(..., { metadataOnly: true })`. Values are stored
 * raw; display-side cleaning (e.g. `cleanMessage`, `stripUnsafeCharacters`)
 * happens in the CLI so the index stays UI-agnostic.
 */
export interface SessionListMetadata {
  sessionId: string;
  startTime: string;
  lastUpdated: string;
  /** The kind of conversation (main agent or subagent). */
  kind?: 'main' | 'subagent';
  hasResumableContent: boolean;
  messageCount: number;
  userMessageCount: number;
  /** Raw first user message, if any. */
  firstUserMessage?: string;
  /** Raw AI-generated summary, if any. */
  summary?: string;
}

/**
 * Index entry for one scanned session file. `metadata` is `null` when the
 * file is unreadable or not a valid session (a cached negative result), so
 * corrupted files are not re-scanned on every list load.
 */
export interface SessionIndexEntry {
  fileName: string;
  /** File size fingerprint used for cache validation. */
  size: number;
  /** File modification-time fingerprint used for cache validation. */
  mtimeMs: number;
  metadata: SessionListMetadata | null;
}

/** On-disk shape of the shared sessions index file. */
export interface SessionsIndexFile {
  version: typeof SESSION_INDEX_VERSION;
  /** Keyed by session file name (e.g. `session-...-abcd1234.jsonl`). */
  sessions: Record<string, SessionIndexEntry>;
}

/** Absolute path of the sessions index file within a chats directory. */
export function getSessionsIndexPath(chatsDir: string): string {
  return path.join(chatsDir, SESSION_INDEX_FILENAME);
}

/**
 * Reads the sessions index. Returns `null` when the file is missing,
 * unreadable, or fails schema validation so callers can fall back to a full
 * scan of the session files.
 */
export async function readSessionsIndex(
  chatsDir: string,
): Promise<SessionsIndexFile | null> {
  const indexPath = getSessionsIndexPath(chatsDir);
  let raw: string;
  try {
    raw = await fs.readFile(indexPath, 'utf-8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSessionsIndexFile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Atomically writes the sessions index (temp file + rename) so concurrent
 * readers or writers never observe a half-written file.
 */
export async function writeSessionsIndex(
  chatsDir: string,
  index: SessionsIndexFile,
): Promise<void> {
  const indexPath = getSessionsIndexPath(chatsDir);
  const tempPath = `${indexPath}.tmp-${process.pid}`;
  await fs.writeFile(tempPath, JSON.stringify(index), 'utf-8');
  await fs.rename(tempPath, indexPath);
}

/**
 * Scans one session file (metadata only) and builds its index entry, stamped
 * with the file fingerprint (`size`/`mtimeMs`) used for later cache
 * validation. Returns a tombstone entry (`metadata: null`) for unreadable or
 * invalid files so they are not re-scanned on every list load.
 */
export async function buildSessionIndexEntry(
  filePath: string,
  stat: { size: number; mtimeMs: number },
): Promise<SessionIndexEntry> {
  const base = {
    fileName: path.basename(filePath),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
  try {
    const record = await loadConversationRecord(filePath, {
      metadataOnly: true,
    });
    if (!record || !record.sessionId) {
      return { ...base, metadata: null };
    }
    return {
      ...base,
      metadata: {
        sessionId: record.sessionId,
        startTime: record.startTime,
        lastUpdated: record.lastUpdated,
        kind: record.kind,
        hasResumableContent: record.hasResumableContent ?? false,
        messageCount: record.messageCount ?? 0,
        userMessageCount: record.userMessageCount ?? 0,
        firstUserMessage: record.firstUserMessage,
        summary: record.summary,
      },
    };
  } catch {
    return { ...base, metadata: null };
  }
}

function isSessionsIndexFile(value: unknown): value is SessionsIndexFile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SessionsIndexFile>;
  if (candidate.version !== SESSION_INDEX_VERSION) return false;
  if (typeof candidate.sessions !== 'object' || candidate.sessions === null) {
    return false;
  }
  return true;
}
