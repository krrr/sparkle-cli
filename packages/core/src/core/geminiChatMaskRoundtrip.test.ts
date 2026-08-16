/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GeminiChat, type HistoryTurn } from './geminiChat.js';
import { ToolOutputMaskingService } from '../context/toolOutputMaskingService.js';
import { loadConversationRecord } from '../services/chatRecordingService.js';
import { convertSessionToClientHistory } from '../utils/sessionUtils.js';
import type { Config } from '../config/config.js';
import type { Part } from '@google/genai';

/**
 * Regression test: the masking round-trip must not lose the first user message.
 *
 * Runtime flow being reproduced:
 *   processTurn() -> tryMaskToolOutputs()                            (client.ts)
 *     -> ToolOutputMaskingService.mask(getDurableHistoryTurns())
 *        // HistoryTurn[] with stable ids, un-coalesced
 *     -> if (maskedCount > 0) chat.setHistory(result.newHistory)
 *        // setHistory preserves HistoryTurns as-is (id + content)
 *
 * The durable-turns round-trip keeps the envCtx turn and the first user
 * message as separate records, so the first user message survives a resume:
 * `convertSessionToClientHistory` (via `isIgnoredUserContent`) drops only the
 * injected `<session_context>` turn, never the user's own text.
 */
describe('masking round-trip', () => {
  let testTempDir: string;
  let chat: GeminiChat;
  let mockConfig: Config;
  let sessionFilePath: string;

  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'mask-roundtrip-test-'),
    );

    mockConfig = {
      get config() {
        return this;
      },
      promptId: 'test-session-id',
      getSessionId: () => 'test-session-id',
      getProjectRoot: () => '/test/project/root',
      storage: {
        getProjectTempDir: () => testTempDir,
      },
      getModel: () => 'gemini-pro',
      isContextManagementEnabled: () => false,
      getDebugMode: () => false,
      getUsageStatisticsEnabled: () => false,
      // Tiny thresholds so masking always triggers on any tool output.
      getToolOutputMaskingConfig: async () => ({
        enabled: true,
        protectionThresholdTokens: 1,
        minPrunableThresholdTokens: 1,
        protectLatestTurn: false,
      }),
      getWorkspaceContext: () => ({ getDirectories: () => [] }),
      toolRegistry: {
        getTool: () => undefined,
      },
    } as unknown as Config;

    chat = new GeminiChat(mockConfig);
    await chat.initialize();

    const chatsDir = path.join(testTempDir, 'chats');
    const files = fs.readdirSync(chatsDir).filter((f) => f.endsWith('.jsonl'));
    sessionFilePath = path.join(chatsDir, files[0]);
  });

  afterEach(async () => {
    if (testTempDir) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
  });

  it('should not lose the first user message when masked history is synced back', async () => {
    // 1. Seed a realistic conversation: envCtx (session_context) followed by
    //    the first user message, then a model tool call and a large
    //    functionResponse output that will trigger masking.
    const bigOutput = Array.from(
      { length: 300 },
      (_, i) => `line ${i}: some file content that is long enough to be masked`,
    ).join('\n');
    const history: HistoryTurn[] = [
      {
        id: 'env-1',
        content: {
          role: 'user',
          parts: [
            {
              text: '<session_context>\nThis is the Sparkle CLI. We are setting up the context for our chat.',
            },
          ],
        },
      },
      {
        id: 'user-1',
        content: { role: 'user', parts: [{ text: 'Please inspect the file' }] },
      },
      {
        id: 'model-1',
        content: {
          role: 'model',
          parts: [
            { text: 'Let me read it.' },
            {
              functionCall: {
                id: 'call-1',
                name: 'read_file',
                args: { file_path: 'README.md' },
              },
            },
          ] as Part[],
        },
      },
      {
        id: 'user-2',
        content: {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'call-1',
                name: 'read_file',
                response: { output: bigOutput },
              },
            },
          ] as Part[],
        },
      },
    ];
    chat.setHistory(history);

    // Baseline: resuming drops only the injected session_context and keeps the
    // first user message.
    const baseline = await loadConversationRecord(sessionFilePath);
    expect(
      convertSessionToClientHistory(baseline!.messages).some(
        (turn) =>
          turn.content.role === 'user' &&
          turn.content.parts?.some((p) => p.text === 'Please inspect the file'),
      ),
    ).toBe(true);

    // 2. The runtime masking path: durable turns (un-coalesced, with ids) ->
    //    mask() -> setHistory(). Masking must trigger, otherwise the test is
    //    useless.
    const durableTurns = chat.getDurableHistoryTurns();
    const maskingService = new ToolOutputMaskingService();
    const { newHistory, maskedCount } = await maskingService.mask(
      durableTurns,
      mockConfig,
    );
    expect(maskedCount).toBeGreaterThan(0);

    chat.setHistory(newHistory);

    // 3. After the round-trip, the first user message must still survive a
    //    resume, and the durable turn identities must be preserved: the
    //    envCtx turn and the first user message stay as separate records
    //    (no merging, no id regeneration).
    const after = await loadConversationRecord(sessionFilePath);
    expect(
      convertSessionToClientHistory(after!.messages).some(
        (turn) =>
          turn.content.role === 'user' &&
          turn.content.parts?.some((p) => p.text === 'Please inspect the file'),
      ),
    ).toBe(true);
    expect(after!.messages.some((m) => m.id === 'env-1')).toBe(true);
    expect(after!.messages.some((m) => m.id === 'user-1')).toBe(true);
    const envTurn = after!.messages.find((m) => m.id === 'env-1');
    expect(
      (envTurn!.content as Part[])
        .map((p) => p.text ?? '')
        .join('')
        .includes('Please inspect the file'),
    ).toBe(false);
  });
});
