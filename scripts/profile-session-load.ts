/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One-off profiling harness for session-file loading.
 *
 * Loads the largest `session-*.jsonl` file under the user's chats directory
 * (or a path passed as argv[2]) using the exact parsing code paths the CLI
 * uses (`loadConversationRecord`, `buildSessionIndexEntry`, and the CLI-side
 * `getAllSessionFiles`), and reports wall-clock timings per phase so
 * hotspots are easy to spot.
 *
 * Usage:
 *   tsx scripts/profile-session-load.ts [path-to-session.jsonl]
 *
 * For a function-level CPU profile, run with Node's cpu-prof enabled and
 * then summarize the generated CPU.<pid>.cpuprofile:
 *   NODE_OPTIONS=--cpu-prof tsx scripts/profile-session-load.ts
 *   node scripts/analyze-cpuprofile.mjs CPU.<pid>.cpuprofile
 */

import { performance } from 'node:perf_hooks';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import readline from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import {
  loadConversationRecord,
  SESSION_FILE_PREFIX,
} from '../packages/core/src/services/chatRecordingService.js';
import { buildSessionIndexEntry } from '../packages/core/src/services/sessionIndex.js';
import {
  getAllSessionFiles,
  convertSessionToHistoryFormats,
} from '../packages/cli/src/utils/sessionUtils.js';

const MB = 1024 * 1024;

const fmtMs = (start: number): string => `${(performance.now() - start).toFixed(1)} ms`;

const fmtBytes = (n: number): string => `${(n / MB).toFixed(1)} MB`;

const fmtHeap = (): string => {
  const used = process.memoryUsage().heapUsed;
  return `${(used / MB).toFixed(0)} MB`;
};

async function findLargestSessionFile(chatsDir: string): Promise<string | null> {
  const files = await fs.readdir(chatsDir);
  let largest: { file: string; size: number } | null = null;
  for (const file of files) {
    if (!file.startsWith(SESSION_FILE_PREFIX) || !file.endsWith('.jsonl')) {
      continue;
    }
    const stat = await fs.stat(path.join(chatsDir, file));
    if (!largest || stat.size > largest.size) {
      largest = { file, size: stat.size };
    }
  }
  return largest ? path.join(chatsDir, largest.file) : null;
}

/**
 * Minimal pass that only reads the file and JSON.parses each line, with none
 * of the record classification/stringification logic. Used to isolate the
 * "I/O + parse" cost from the processing overhead of the real loader.
 */
async function timeParseOnly(
  filePath: string,
): Promise<{ lines: number; elapsedMs: number }> {
  const start = performance.now();
  let lines = 0;
  const stream = fsSync.createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    JSON.parse(line);
    lines++;
  }
  return { lines, elapsedMs: performance.now() - start };
}

async function main(): Promise<void> {
  const chatsDir = path.join(os.homedir(), '.sparkle', 'data', 'sparkle-cli', 'chats');

  const explicit = process.argv[2];
  const filePath = explicit
    ? path.resolve(explicit)
    : await findLargestSessionFile(chatsDir);
  if (!filePath) {
    console.error(`No session files found under ${chatsDir}`);
    process.exit(1);
  }

  const stat = await fs.stat(filePath);
  console.log('=== Session file ===');
  console.log(`path:   ${filePath}`);
  console.log(`size:   ${fmtBytes(stat.size)}`);
  console.log(`mtime:  ${stat.mtime.toISOString()}`);
  console.log(`heap:   ${fmtHeap()} (before)`);

  // 1) Metadata-only load — what the session index scan does per file.
  let start = performance.now();
  await loadConversationRecord(filePath, {
    metadataOnly: true,
  });
  console.log('\n[1] loadConversationRecord(metadataOnly):');
  console.log(`    cold: ${fmtMs(start)}`);
  start = performance.now();
  await loadConversationRecord(filePath, { metadataOnly: true });
  console.log(`    warm: ${fmtMs(start)}`);

  // 2) buildSessionIndexEntry — adds fingerprint stamping on top of [1].
  start = performance.now();
  const indexEntry = await buildSessionIndexEntry(filePath, stat);
  console.log('\n[2] buildSessionIndexEntry:');
  console.log(`    ${fmtMs(start)}  (metadata=${indexEntry.metadata ? 'ok' : 'null'})`);

  // 3) Full load — the expensive path (resume / search).
  const heapBefore = process.memoryUsage().heapUsed;
  start = performance.now();
  const full = await loadConversationRecord(filePath);
  const fullMs = performance.now() - start;
  const heapDelta = process.memoryUsage().heapUsed - heapBefore;
  const cpuMs = process.cpuUsage().user / 1000; // µs -> ms, cumulative
  console.log('\n[3] loadConversationRecord(full):');
  console.log(`    ${fmtMs(start)}  (${full ? full.messages.length : 0} messages)`);
  console.log(`    heap delta: +${fmtBytes(heapDelta)}  (heap now ${fmtHeap()})`);

  // 4) I/O + JSON.parse only (no processing logic).
  const parseOnly = await timeParseOnly(filePath);
  console.log('\n[4] I/O + JSON.parse only:');
  console.log(`    ${parseOnly.elapsedMs.toFixed(1)} ms  (${parseOnly.lines} lines)`);
  const processingMs = fullMs - parseOnly.elapsedMs;
  console.log(
    `    => processing overhead (message classification, stringification, rewind/dedupe): ` +
      `${processingMs.toFixed(1)} ms (${processingMs > 0 ? ((processingMs / fullMs) * 100).toFixed(0) : 0}% of full load)`,
  );
  console.log(`    (cumulative user CPU at this point: ${cpuMs.toFixed(1)} ms)`);

  // 5) CLI production path (getAllSessionFiles) against a temp copy of the
  //    file, so the sidecar index state is controlled: cold (no index) then
  //    warm (index just written).
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sparkle-session-profile-'));
  try {
    const copyPath = path.join(tmpDir, path.basename(filePath));
    await fs.copyFile(filePath, copyPath);
    console.log('\n[5] CLI getAllSessionFiles (temp copy, controlled index):');
    start = performance.now();
    const cold = await getAllSessionFiles(tmpDir);
    console.log(tmpDir);
    console.log(`    cold index: ${fmtMs(start)}  (${cold.length} entries)`);
    start = performance.now();
    const warm = await getAllSessionFiles(tmpDir);
    console.log(`    warm index: ${fmtMs(start)}  (${warm.length} entries)`);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  // 6) UI-history conversion — runs right after the full load when the
  //    SessionBrowser or resume flow shows a session.
  if (full) {
    start = performance.now();
    const historyData = convertSessionToHistoryFormats(full.messages);
    console.log('\n[6] convertSessionToHistoryFormats (UI history):');
    console.log(
      `    ${fmtMs(start)}  (${historyData.uiHistory.length} UI items from ${full.messages.length} messages)`,
    );
  }

  // 7) Line distribution — where the bytes actually live.
  {
    const sizes: Array<{ lineNo: number; bytes: number; kind: string }> = [];
    let msgLines = 0;
    let setLines = 0;
    let rewindLines = 0;
    const stream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let lineNo = 0;
    for await (const line of rl) {
      if (!line.trim()) continue;
      lineNo++;
      const trimmed = line.startsWith(' ') ? line.slice(1) : line;
      const kind = trimmed.startsWith('{"$set"')
        ? '$set'
        : trimmed.startsWith('{"$rewindTo"')
          ? '$rewindTo'
          : 'message';
      if (kind === '$set') setLines++;
      else if (kind === '$rewindTo') rewindLines++;
      else msgLines++;
      sizes.push({ lineNo, bytes: Buffer.byteLength(line), kind });
    }
    sizes.sort((a, b) => b.bytes - a.bytes);
    const total = sizes.reduce((sum, s) => sum + s.bytes, 0);
    console.log('\n[7] Line distribution:');
    console.log(
      `    lines: ${sizes.length} (message=${msgLines}, $set=${setLines}, $rewindTo=${rewindLines})`,
    );
    console.log(`    top 5 largest lines:`);
    for (const s of sizes.slice(0, 5)) {
      console.log(`      #${s.lineNo}  ${(s.bytes / MB).toFixed(2)} MB  (${s.kind})`);
    }
    const top5 = sizes.slice(0, 5).reduce((sum, s) => sum + s.bytes, 0);
    console.log(
      `    top 5 lines = ${((top5 / total) * 100).toFixed(0)}% of file bytes`,
    );
    const medianBytes = sizes[Math.floor(sizes.length / 2)]?.bytes ?? 0;
    console.log(`    median line: ${(medianBytes / 1024).toFixed(1)} KB`);
  }

  console.log('\n=== Done ===');
  if (full) {
    console.log(
      `sessionId=${full.sessionId} firstUserMessage=${full.firstUserMessage ?? '(none)'} summary=${full.summary ? 'yes' : 'no'}`,
    );
  }
  if (!explicit) {
    console.log(`(largest file under ${chatsDir} was selected)`);
  }
  console.log(
    'Tip: for a function-level breakdown, rerun with NODE_OPTIONS=--cpu-prof and summarize with scripts/analyze-cpuprofile.mjs',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
