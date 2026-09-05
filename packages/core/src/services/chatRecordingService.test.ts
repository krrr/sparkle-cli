/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, it, describe, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const fsModule = {
    ...actual,
    mkdirSync: vi.fn(actual.mkdirSync),
    appendFileSync: vi.fn(actual.appendFileSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    readFileSync: vi.fn(actual.readFileSync),
    unlinkSync: vi.fn(actual.unlinkSync),
    existsSync: vi.fn(actual.existsSync),
    readdirSync: vi.fn(actual.readdirSync),
    promises: {
      ...actual.promises,
      stat: vi.fn(actual.promises.stat),
      readFile: vi.fn(actual.promises.readFile),
      unlink: vi.fn(actual.promises.unlink),
      readdir: vi.fn(actual.promises.readdir),
      open: vi.fn(actual.promises.open),
      rm: vi.fn(actual.promises.rm),
      mkdir: vi.fn(actual.promises.mkdir),
      writeFile: vi.fn(actual.promises.writeFile),
    },
  };
  return {
    ...fsModule,
    default: fsModule,
  };
});

import {
  ChatRecordingService,
  MAX_FIRST_USER_MESSAGE_LENGTH,
  hasResumableConversationContent,
  isResumableMessageRecord,
  loadConversationRecord,
  type ConversationRecord,
  type ToolCallRecord,
  type MessageRecord,
} from './chatRecordingService.js';
import type { WorkspaceContext } from '../utils/workspaceContext.js';
import { CoreToolCallStatus } from '../scheduler/types.js';
import type { Config } from '../config/config.js';
import { getProjectHash } from '../utils/paths.js';
import type { HistoryTurn } from '../core/agentChatHistory.js';
import { convertSessionToClientHistory } from '../utils/sessionUtils.js';
import { geminiContentsToOpenAiMessages } from '../core/openAiFormatConverter.js';

vi.mock('../utils/paths.js');
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  let count = 0;
  return {
    ...actual,
    randomUUID: vi.fn(() => `test-uuid-${count++}`),
    createHash: vi.fn(() => ({
      update: vi.fn(() => ({
        digest: vi.fn(() => 'mocked-hash'),
      })),
    })),
  };
});

describe('ChatRecordingService', () => {
  let chatRecordingService: ChatRecordingService;
  let mockConfig: Config;
  let testTempDir: string;

  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(async () => {
    testTempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'chat-recording-test-'),
    );

    mockConfig = {
      get config() {
        return this;
      },
      toolRegistry: {
        getTool: vi.fn(),
      },
      promptId: 'test-session-id',
      getSessionId: vi.fn().mockReturnValue('test-session-id'),
      getProjectRoot: vi.fn().mockReturnValue('/test/project/root'),
      storage: {
        getProjectTempDir: vi.fn().mockReturnValue(testTempDir),
        getProjectDataDir: vi.fn().mockReturnValue(testTempDir),
      },
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getDebugMode: vi.fn().mockReturnValue(false),
      getWorkspaceContext: vi.fn().mockReturnValue({
        getDirectories: vi.fn().mockReturnValue([]),
      }),
      getToolRegistry: vi.fn().mockReturnValue({
        getTool: vi.fn().mockReturnValue({
          displayName: 'Test Tool',
          description: 'A test tool',
          isOutputMarkdown: false,
        }),
      }),
    } as unknown as Config;

    // Ensure mockConfig.config points to itself for AgentLoopContext parity
    Object.defineProperty(mockConfig, 'config', {
      get() {
        return mockConfig;
      },
    });

    vi.mocked(getProjectHash).mockReturnValue('test-project-hash');
    chatRecordingService = new ChatRecordingService(mockConfig);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (testTempDir) {
      await fs.promises.rm(testTempDir, { recursive: true, force: true });
    }
  });

  describe('isResumableMessageRecord', () => {
    it('should treat malformed messages without content as non-resumable', () => {
      const message = {
        id: 'malformed-message',
        timestamp: '2024-01-01T00:00:00.000Z',
        type: 'user',
      } as MessageRecord;

      expect(() => isResumableMessageRecord(message)).not.toThrow();
      expect(isResumableMessageRecord(message)).toBe(false);
    });

    it('should return false for command-only messages', () => {
      const messages = [
        {
          type: 'user',
          content: '/resume',
          id: 'msg1',
          timestamp: '2024-01-01T10:00:00.000Z',
        },
        {
          type: 'user',
          content: '?help',
          id: 'msg2',
          timestamp: '2024-01-01T10:01:00.000Z',
        },
      ] as MessageRecord[];

      expect(hasResumableConversationContent(messages)).toBe(false);
    });

    it('should return false for internal context-only messages', () => {
      const messages = [
        {
          type: 'user',
          content: '<session_context>previous state</session_context>',
          id: 'msg1',
          timestamp: '2024-01-01T10:00:00.000Z',
        },
        {
          type: 'user',
          content: '<hook_context>hook data</hook_context>',
          id: 'msg2',
          timestamp: '2024-01-01T10:01:00.000Z',
        },
      ] as MessageRecord[];

      expect(hasResumableConversationContent(messages)).toBe(false);
    });

    it('should return true for real user or assistant content', () => {
      const messages = [
        {
          type: 'user',
          content: '/resume',
          id: 'msg1',
          timestamp: '2024-01-01T10:00:00.000Z',
        },
        {
          type: 'gemini',
          content: 'I can help with that.',
          id: 'msg2',
          timestamp: '2024-01-01T10:01:00.000Z',
        },
      ] as MessageRecord[];

      expect(hasResumableConversationContent(messages)).toBe(true);
    });
  });

  describe('initialize', () => {
    it('should create a new session if none is provided', async () => {
      await chatRecordingService.initialize();
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'ping',
        model: 'm',
      });

      const chatsDir = path.join(testTempDir, 'chats');
      expect(fs.existsSync(chatsDir)).toBe(true);
      const files = fs.readdirSync(chatsDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]).toMatch(/^session-.*-test-ses\.jsonl$/);
    });

    it('should include the conversation kind when specified', async () => {
      await chatRecordingService.initialize(undefined, 'subagent');
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'ping',
        model: 'm',
      });

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      expect(conversation.kind).toBe('subagent');
    });

    it('should create a subdirectory for subagents if parentSessionId is present', async () => {
      const parentSessionId = 'test-parent-uuid';
      Object.defineProperty(mockConfig, 'parentSessionId', {
        value: parentSessionId,
        writable: true,
        configurable: true,
      });

      await chatRecordingService.initialize(undefined, 'subagent');
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'ping',
        model: 'm',
      });

      const chatsDir = path.join(testTempDir, 'chats');
      const subagentDir = path.join(chatsDir, parentSessionId);
      expect(fs.existsSync(subagentDir)).toBe(true);

      const files = fs.readdirSync(subagentDir);
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]).toBe('test-session-id.jsonl');
    });

    it('should inherit workspace directories for subagents during initialization', async () => {
      const mockDirectories = ['/project/dir1', '/project/dir2'];
      vi.mocked(mockConfig.getWorkspaceContext).mockReturnValue({
        getDirectories: vi.fn().mockReturnValue(mockDirectories),
      } as unknown as WorkspaceContext);

      // Initialize as a subagent
      await chatRecordingService.initialize(undefined, 'subagent');

      // Recording a message triggers the disk write
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'ping',
        model: 'm',
      });

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;

      expect(conversation.kind).toBe('subagent');
      expect(conversation.directories).toEqual(mockDirectories);
    });

    it('should resume from an existing session if provided', async () => {
      const chatsDir = path.join(testTempDir, 'chats');
      fs.mkdirSync(chatsDir, { recursive: true });
      const sessionFile = path.join(chatsDir, 'session.jsonl');
      const initialData = {
        sessionId: 'old-session-id',
        projectHash: 'test-project-hash',
        messages: [],
      };
      fs.writeFileSync(
        sessionFile,
        JSON.stringify({ ...initialData, messages: undefined }) +
          '\n' +
          (initialData.messages || [])
            .map((m: unknown) => JSON.stringify(m))
            .join('\n') +
          '\n',
      );

      await chatRecordingService.initialize({
        filePath: sessionFile,
        conversation: {
          sessionId: 'old-session-id',
        } as ConversationRecord,
      });

      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      expect(conversation.sessionId).toBe('old-session-id');
    });

    it('should fall back to the in-memory conversation when the file cannot be reloaded', async () => {
      // Regression test for the `/compress` "Failed to load resumed session
      // data from file" bug: when resuming with a filePath that cannot be
      // loaded from disk, initialize must NOT throw. It should adopt the
      // in-memory conversation it was handed and rewrite a clean file.
      const chatsDir = path.join(testTempDir, 'chats');
      fs.mkdirSync(chatsDir, { recursive: true });
      const missingFile = path.join(chatsDir, 'missing-session.jsonl');
      expect(fs.existsSync(missingFile)).toBe(false);

      const inMemoryConversation = {
        sessionId: 'resumed-session-id',
        projectHash: 'resumed-project-hash',
        startTime: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        messages: [
          {
            id: 'msg-1',
            type: 'user',
            timestamp: new Date().toISOString(),
            content: 'hello from memory',
          },
        ],
      } as unknown as ConversationRecord;

      await expect(
        chatRecordingService.initialize({
          filePath: missingFile,
          conversation: inMemoryConversation,
        }),
      ).resolves.not.toThrow();

      // The in-memory conversation is adopted.
      expect(chatRecordingService.getConversation()?.sessionId).toBe(
        'resumed-session-id',
      );

      // A clean, loadable file is rewritten from the in-memory copy so future
      // loads and appends succeed.
      const reloaded = (await loadConversationRecord(
        missingFile,
      )) as ConversationRecord;
      expect(reloaded).not.toBeNull();
      expect(reloaded.sessionId).toBe('resumed-session-id');
      expect(reloaded.projectHash).toBe('resumed-project-hash');
      expect(reloaded.messages).toHaveLength(1);
    });

    it('should preserve an unreadable session file instead of destroying it', async () => {
      // The reload may have failed only transiently, so the original bytes
      // must survive the recovery rewrite.
      const chatsDir = path.join(testTempDir, 'chats');
      fs.mkdirSync(chatsDir, { recursive: true });
      const sessionFile = path.join(chatsDir, 'unreadable.jsonl');

      // No usable metadata line => loadConversationRecord() returns null.
      const originalBytes = '{"not":"a valid metadata line"}\n';
      fs.writeFileSync(sessionFile, originalBytes);

      await chatRecordingService.initialize({
        filePath: sessionFile,
        conversation: {
          sessionId: 'recovered-session-id',
          projectHash: 'recovered-project-hash',
          startTime: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          messages: [],
        } as unknown as ConversationRecord,
      });

      // The rewritten file is loadable again...
      const reloaded = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      expect(reloaded.sessionId).toBe('recovered-session-id');

      // ...and the original bytes were kept alongside it.
      const preserved = fs
        .readdirSync(chatsDir)
        .filter((f) => f.startsWith('unreadable.jsonl.unreadable-'));
      expect(preserved).toHaveLength(1);
      expect(fs.readFileSync(path.join(chatsDir, preserved[0]), 'utf-8')).toBe(
        originalBytes,
      );
    });

    it('should not leave a temp file behind when the rewrite fails', async () => {
      const chatsDir = path.join(testTempDir, 'chats');
      fs.mkdirSync(chatsDir, { recursive: true });
      const sessionFile = path.join(chatsDir, 'rewrite-fails.jsonl');

      // Fail the rename that publishes the temp file, leaving it orphaned.
      const realRename = fs.renameSync;
      vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (String(from).includes('.tmp-')) {
          throw new Error('simulated rename failure');
        }
        return realRename(from, to);
      });

      await expect(
        chatRecordingService.initialize({
          filePath: sessionFile,
          conversation: {
            sessionId: 'temp-cleanup-session',
            projectHash: 'temp-cleanup-hash',
            startTime: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            messages: [],
          } as unknown as ConversationRecord,
        }),
      ).rejects.toThrow('simulated rename failure');

      const leftovers = fs
        .readdirSync(chatsDir)
        .filter((f) => f.includes('.tmp-'));
      expect(leftovers).toEqual([]);
    });
  });

  describe('lazy persistence (deferred file creation)', () => {
    it('should buffer injected context and only write on the first real user message', async () => {
      await chatRecordingService.initialize();

      // Simulate GeminiChat.initialize: the bootstrap history only contains
      // the injected <session_context> turn.
      chatRecordingService.updateMessagesFromHistory([
        {
          id: 'env-1',
          content: {
            role: 'user',
            parts: [
              { text: '<session_context>Startup context</session_context>' },
            ],
          },
        },
      ]);

      const conversationFile = chatRecordingService.getConversationFilePath()!;
      // Nothing durable yet -> the file must not exist...
      expect(fs.existsSync(conversationFile)).toBe(false);
      // ...but the in-memory record is fully populated.
      expect(chatRecordingService.getConversation()!.messages).toHaveLength(1);

      // A real user message materializes the file with metadata first,
      // followed by the buffered context and the user message in order.
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'Hello world',
        model: 'gemini-pro',
      });

      expect(fs.existsSync(conversationFile)).toBe(true);
      const conversation = (await loadConversationRecord(
        conversationFile,
      )) as ConversationRecord;
      expect(conversation.messages).toHaveLength(2);
      expect(JSON.stringify(conversation.messages[0].content)).toContain(
        '<session_context>',
      );
      expect(conversation.messages[1].content).toBe('Hello world');
    });

    it('should flush when the history sync carries a real user turn (context management flow)', async () => {
      await chatRecordingService.initialize();

      chatRecordingService.updateMessagesFromHistory([
        {
          id: 'env-1',
          content: {
            role: 'user',
            parts: [
              { text: '<session_context>Startup context</session_context>' },
            ],
          },
        },
        {
          id: 'user-1',
          content: { role: 'user', parts: [{ text: 'First question' }] },
        },
      ]);

      const conversationFile = chatRecordingService.getConversationFilePath()!;
      expect(fs.existsSync(conversationFile)).toBe(true);
      const conversation = (await loadConversationRecord(
        conversationFile,
      )) as ConversationRecord;
      expect(conversation.messages.map((m) => m.id)).toEqual([
        'env-1',
        'user-1',
      ]);
    });

    it('should write metadata first and clear the buffer after flushing', async () => {
      await chatRecordingService.initialize();
      chatRecordingService.recordSyntheticMessage('user', [
        { text: '<session_context>Buffered</session_context>' },
      ]);

      chatRecordingService.recordMessage({
        type: 'user',
        content: 'Real prompt',
        model: 'gemini-pro',
      });

      const conversationFile = chatRecordingService.getConversationFilePath()!;
      const lines = fs
        .readFileSync(conversationFile, 'utf-8')
        .trim()
        .split('\n');
      const first = JSON.parse(lines[0]) as ConversationRecord;
      expect(first.sessionId).toBe('test-session-id');
      expect(first.messages).toBeUndefined();

      // The in-memory buffer is cleared once the file is materialized.
      // @ts-expect-error private property
      expect(chatRecordingService.pendingMetadata).toBeNull();
      // @ts-expect-error private property
      expect(chatRecordingService.pendingRecords).toEqual([]);
    });

    it('should not flush for command-only or injected-context content', async () => {
      await chatRecordingService.initialize();
      chatRecordingService.recordMessage({
        type: 'user',
        content: '/resume',
        model: 'gemini-pro',
      });
      chatRecordingService.recordSyntheticMessage('user', [
        { text: '<hook_context>hook data</hook_context>' },
      ]);

      const conversationFile = chatRecordingService.getConversationFilePath()!;
      expect(fs.existsSync(conversationFile)).toBe(false);
      // The in-memory record still reflects everything.
      expect(chatRecordingService.getConversation()!.messages).toHaveLength(2);
    });

    it('should retain the buffer and retry when the flush fails with a non-ENOSPC error', async () => {
      await chatRecordingService.initialize();
      chatRecordingService.recordSyntheticMessage('user', [
        { text: '<session_context>Buffered</session_context>' },
      ]);

      const otherError = new Error('Permission denied');
      (otherError as NodeJS.ErrnoException).code = 'EACCES';
      const appendFileSyncSpy = vi
        .mocked(fs.appendFileSync)
        .mockImplementationOnce(() => {
          throw otherError;
        });

      // The failed flush propagates and the message is not recorded.
      expect(() =>
        chatRecordingService.recordMessage({
          type: 'user',
          content: 'First attempt',
          model: 'gemini-pro',
        }),
      ).toThrow('Permission denied');

      const conversationFile = chatRecordingService.getConversationFilePath()!;
      expect(fs.existsSync(conversationFile)).toBe(false);
      // The buffered records (the context message plus its lastUpdated $set)
      // survive the failed flush.
      // @ts-expect-error private property
      expect(chatRecordingService.pendingRecords).toHaveLength(2);

      // A later flush retries with the preserved buffer.
      appendFileSyncSpy.mockClear();
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'Second attempt',
        model: 'gemini-pro',
      });

      expect(fs.existsSync(conversationFile)).toBe(true);
      const conversation = (await loadConversationRecord(
        conversationFile,
      )) as ConversationRecord;
      const contents = conversation.messages.map((m) =>
        JSON.stringify(m.content),
      );
      expect(contents).toHaveLength(2);
      expect(contents[0]).toContain('<session_context>');
      expect(conversation.messages[1].content).toBe('Second attempt');
    });
  });

  describe('recordMessage', () => {
    beforeEach(async () => {
      await chatRecordingService.initialize();
    });

    it('should record a new message', async () => {
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'Hello',
        displayContent: 'User Hello',
        model: 'gemini-pro',
      });

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;

      expect(conversation.messages).toHaveLength(1);
      expect(conversation.messages[0].content).toBe('Hello');
      expect(conversation.messages[0].displayContent).toBe('User Hello');
      expect(conversation.messages[0].type).toBe('user');
    });

    it('should create separate messages when recording multiple messages', async () => {
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'World',
        model: 'gemini-pro',
      });

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      expect(conversation.messages).toHaveLength(1);
      expect(conversation.messages[0].content).toBe('World');
    });
  });

  describe('loadConversationRecord firstUserMessage truncation', () => {
    function writeSessionWithFirstMessage(content: string): string {
      const chatsDir = path.join(testTempDir, 'chats');
      fs.mkdirSync(chatsDir, { recursive: true });
      const sessionFile = path.join(chatsDir, 'session-truncate.jsonl');
      fs.writeFileSync(
        sessionFile,
        [
          JSON.stringify({
            sessionId: 'truncate-session',
            projectHash: 'test-project-hash',
            startTime: '2024-01-01T00:00:00.000Z',
            lastUpdated: '2024-01-01T00:01:00.000Z',
          }),
          JSON.stringify({
            id: 'm1',
            timestamp: '2024-01-01T00:00:00.000Z',
            type: 'user',
            content,
          }),
        ].join('\n') + '\n',
      );
      return sessionFile;
    }

    it('truncates an over-long first user message in metadataOnly mode', async () => {
      const longContent = 'a'.repeat(300);
      const sessionFile = writeSessionWithFirstMessage(longContent);

      const conversation = (await loadConversationRecord(sessionFile, {
        metadataOnly: true,
      })) as ConversationRecord & { firstUserMessage?: string };

      expect(conversation.firstUserMessage).toBe(
        longContent.slice(0, MAX_FIRST_USER_MESSAGE_LENGTH),
      );
    });

    it('truncates an over-long first user message in full-content mode', async () => {
      const longContent = 'a'.repeat(300);
      const sessionFile = writeSessionWithFirstMessage(longContent);

      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord & { firstUserMessage?: string };

      expect(conversation.firstUserMessage).toBe(
        longContent.slice(0, MAX_FIRST_USER_MESSAGE_LENGTH),
      );
    });

    it('keeps short first user messages unchanged', async () => {
      const sessionFile = writeSessionWithFirstMessage('Hello world');

      const conversation = (await loadConversationRecord(sessionFile, {
        metadataOnly: true,
      })) as ConversationRecord & { firstUserMessage?: string };

      expect(conversation.firstUserMessage).toBe('Hello world');
    });
  });

  describe('recordThought', () => {
    it('should queue a thought', async () => {
      await chatRecordingService.initialize();
      chatRecordingService.recordThought({
        subject: 'Thinking',
        description: 'Thinking...',
      });
      // @ts-expect-error private property
      expect(chatRecordingService.queuedThoughts).toHaveLength(1);
      // @ts-expect-error private property
      expect(chatRecordingService.queuedThoughts[0].subject).toBe('Thinking');
    });
  });

  describe('recordMessageTokens', () => {
    beforeEach(async () => {
      await chatRecordingService.initialize();
    });

    it('should update the last message with token info', async () => {
      chatRecordingService.recordMessage({
        type: 'gemini',
        content: 'Response',
        model: 'gemini-pro',
      });

      chatRecordingService.recordMessageTokens({
        promptTokenCount: 1,
        candidatesTokenCount: 2,
        totalTokenCount: 3,
        cachedContentTokenCount: 0,
      });

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      const geminiMsg = conversation.messages[0] as MessageRecord & {
        type: 'gemini';
      };
      expect(geminiMsg.tokens).toEqual({
        input: 1,
        output: 2,
        total: 3,
        cached: 0,
        thoughts: 0,
        tool: 0,
      });
    });

    it('should queue token info if the last message already has tokens', async () => {
      chatRecordingService.recordMessage({
        type: 'gemini',
        content: 'Response',
        model: 'gemini-pro',
      });

      chatRecordingService.recordMessageTokens({
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
        cachedContentTokenCount: 0,
      });

      chatRecordingService.recordMessageTokens({
        promptTokenCount: 2,
        candidatesTokenCount: 2,
        totalTokenCount: 4,
        cachedContentTokenCount: 0,
      });

      // @ts-expect-error private property
      expect(chatRecordingService.queuedTokens).toEqual({
        input: 2,
        output: 2,
        total: 4,
        cached: 0,
        thoughts: 0,
        tool: 0,
      });
    });

    it('should not write to disk when queuing tokens (no last gemini message)', async () => {
      const appendFileSyncSpy = vi.mocked(fs.appendFileSync);

      // Clear spy call count after initialize writes the initial file
      appendFileSyncSpy.mockClear();

      // No gemini message recorded yet, so tokens should only be queued
      chatRecordingService.recordMessageTokens({
        promptTokenCount: 5,
        candidatesTokenCount: 10,
        totalTokenCount: 15,
        cachedContentTokenCount: 0,
      });

      // writeFileSync should NOT have been called since we only queued
      expect(appendFileSyncSpy).not.toHaveBeenCalled();

      // @ts-expect-error private property
      expect(chatRecordingService.queuedTokens).toEqual({
        input: 5,
        output: 10,
        total: 15,
        cached: 0,
        thoughts: 0,
        tool: 0,
      });
    });

    it('should not write to disk when queuing tokens (last message already has tokens)', async () => {
      chatRecordingService.recordMessage({
        type: 'gemini',
        content: 'Response',
        model: 'gemini-pro',
      });

      // First recordMessageTokens updates the message and writes to disk
      chatRecordingService.recordMessageTokens({
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
        cachedContentTokenCount: 0,
      });

      const appendFileSyncSpy = vi.mocked(fs.appendFileSync);
      appendFileSyncSpy.mockClear();

      // Second call should only queue, NOT write to disk
      chatRecordingService.recordMessageTokens({
        promptTokenCount: 2,
        candidatesTokenCount: 2,
        totalTokenCount: 4,
        cachedContentTokenCount: 0,
      });

      expect(appendFileSyncSpy).not.toHaveBeenCalled();
    });

    it('should use in-memory cache and not re-read from disk on subsequent operations', async () => {
      chatRecordingService.recordMessage({
        type: 'gemini',
        content: 'Response',
        model: 'gemini-pro',
      });

      const readFileSyncSpy = vi.mocked(fs.readFileSync);
      readFileSyncSpy.mockClear();

      // These operations should all use the in-memory cache
      chatRecordingService.recordMessageTokens({
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
        cachedContentTokenCount: 0,
      });

      chatRecordingService.recordMessage({
        type: 'gemini',
        content: 'Another response',
        model: 'gemini-pro',
      });

      chatRecordingService.saveSummary('Test summary');

      // readFileSync should NOT have been called since we use the in-memory cache
      expect(readFileSyncSpy).not.toHaveBeenCalled();
    });
  });

  describe('recordToolCalls', () => {
    beforeEach(async () => {
      await chatRecordingService.initialize();
    });

    it('should add new tool calls to the last message', async () => {
      // Mirrors the real flow: a genuine user prompt precedes the model's
      // tool-call turn and materializes the session file (lazy persistence).
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'Run a tool',
        model: 'gemini-pro',
      });
      chatRecordingService.recordMessage({
        type: 'gemini',
        content: '',
        model: 'gemini-pro',
      });

      const toolCall: ToolCallRecord = {
        id: 'tool-1',
        name: 'testTool',
        args: {},
        status: CoreToolCallStatus.AwaitingApproval,
        timestamp: new Date().toISOString(),
      };
      chatRecordingService.recordToolCalls('gemini-pro', [toolCall]);

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      const geminiMsg = conversation.messages[1] as MessageRecord & {
        type: 'gemini';
      };
      expect(geminiMsg.toolCalls).toHaveLength(1);
      expect(geminiMsg.toolCalls![0].name).toBe('testTool');
    });

    it('should preserve dynamic description and NOT overwrite with generic one', async () => {
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'Run a tool',
        model: 'gemini-pro',
      });
      chatRecordingService.recordMessage({
        type: 'gemini',
        content: '',
        model: 'gemini-pro',
      });

      const dynamicDescription = 'DYNAMIC DESCRIPTION (e.g. Read file foo.txt)';
      const toolCall: ToolCallRecord = {
        id: 'tool-1',
        name: 'testTool',
        args: {},
        status: CoreToolCallStatus.Success,
        timestamp: new Date().toISOString(),
        description: dynamicDescription,
      };

      chatRecordingService.recordToolCalls('gemini-pro', [toolCall]);

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      const geminiMsg = conversation.messages[1] as MessageRecord & {
        type: 'gemini';
      };

      expect(geminiMsg.toolCalls![0].description).toBe(dynamicDescription);
    });

    it('should create a new message if the last message is not from gemini', async () => {
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'call a tool',
        model: 'gemini-pro',
      });

      const toolCall: ToolCallRecord = {
        id: 'tool-1',
        name: 'testTool',
        args: {},
        status: CoreToolCallStatus.AwaitingApproval,
        timestamp: new Date().toISOString(),
      };
      chatRecordingService.recordToolCalls('gemini-pro', [toolCall]);

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      expect(conversation.messages).toHaveLength(2);
      expect(conversation.messages[1].type).toBe('gemini');
      expect(
        (conversation.messages[1] as MessageRecord & { type: 'gemini' })
          .toolCalls,
      ).toHaveLength(1);
    });

    it('should record agentId when provided', async () => {
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'Run a tool',
        model: 'gemini-pro',
      });
      chatRecordingService.recordMessage({
        type: 'gemini',
        content: '',
        model: 'gemini-pro',
      });

      const toolCall: ToolCallRecord = {
        id: 'tool-1',
        name: 'testTool',
        args: {},
        status: CoreToolCallStatus.Success,
        timestamp: new Date().toISOString(),
        agentId: 'test-agent-id',
      };
      chatRecordingService.recordToolCalls('gemini-pro', [toolCall]);

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      const geminiMsg = conversation.messages[1] as MessageRecord & {
        type: 'gemini';
      };
      expect(geminiMsg.toolCalls).toHaveLength(1);
      expect(geminiMsg.toolCalls![0].agentId).toBe('test-agent-id');
    });
  });

  describe('deleteSession', () => {
    it('should delete the session file, tool outputs, session directory, and logs if they exist', async () => {
      const sessionId = 'test-session-id';
      const shortId = '12345678';
      const chatsDir = path.join(testTempDir, 'chats');
      const logsDir = path.join(testTempDir, 'logs');
      const toolOutputsDir = path.join(testTempDir, 'tool-outputs');
      const sessionDir = path.join(testTempDir, sessionId);

      fs.mkdirSync(chatsDir, { recursive: true });
      fs.mkdirSync(logsDir, { recursive: true });
      fs.mkdirSync(toolOutputsDir, { recursive: true });
      fs.mkdirSync(sessionDir, { recursive: true });

      // Create main session file with timestamp
      const sessionFile = path.join(
        chatsDir,
        `session-2023-01-01T00-00-${shortId}.jsonl`,
      );
      fs.writeFileSync(sessionFile, JSON.stringify({ sessionId }) + '\n');

      const logFile = path.join(logsDir, `session-${sessionId}.jsonl`);
      fs.writeFileSync(logFile, '{}');

      const toolOutputDir = path.join(toolOutputsDir, `session-${sessionId}`);
      fs.mkdirSync(toolOutputDir, { recursive: true });

      // Call with shortId
      await chatRecordingService.deleteSession(shortId);

      expect(fs.existsSync(sessionFile)).toBe(false);
      expect(fs.existsSync(logFile)).toBe(false);
      expect(fs.existsSync(toolOutputDir)).toBe(false);
      expect(fs.existsSync(sessionDir)).toBe(false);
    });

    it('should delete the session file even if it is corrupted (invalid JSON)', async () => {
      const shortId = 'corrupt1';
      const chatsDir = path.join(testTempDir, 'chats');

      fs.mkdirSync(chatsDir, { recursive: true });

      const sessionFile = path.join(
        chatsDir,
        `session-2023-01-01T00-00-${shortId}.jsonl`,
      );
      fs.writeFileSync(sessionFile, 'not-json');

      await chatRecordingService.deleteSession(shortId);

      expect(fs.existsSync(sessionFile)).toBe(false);
    });

    it('should delete subagent files and their logs when parent is deleted', async () => {
      const parentSessionId = '12345678-session-id';
      const shortId = '12345678';
      const subagentSessionId = 'subagent-session-id';
      const chatsDir = path.join(testTempDir, 'chats');
      const logsDir = path.join(testTempDir, 'logs');
      const toolOutputsDir = path.join(testTempDir, 'tool-outputs');

      fs.mkdirSync(chatsDir, { recursive: true });
      fs.mkdirSync(logsDir, { recursive: true });
      fs.mkdirSync(toolOutputsDir, { recursive: true });

      // Create parent session file
      const parentFile = path.join(
        chatsDir,
        `session-2023-01-01T00-00-${shortId}.jsonl`,
      );
      fs.writeFileSync(
        parentFile,
        JSON.stringify({ sessionId: parentSessionId }) + '\n',
      );

      // Create subagent session file in subdirectory
      const subagentDir = path.join(chatsDir, parentSessionId);
      fs.mkdirSync(subagentDir, { recursive: true });
      const subagentFile = path.join(subagentDir, `${subagentSessionId}.jsonl`);
      fs.writeFileSync(
        subagentFile,
        JSON.stringify({ sessionId: subagentSessionId, kind: 'subagent' }) +
          '\n',
      );

      // Create logs for both
      const parentLog = path.join(logsDir, `session-${parentSessionId}.jsonl`);
      fs.writeFileSync(parentLog, '{}');
      const subagentLog = path.join(
        logsDir,
        `session-${subagentSessionId}.jsonl`,
      );
      fs.writeFileSync(subagentLog, '{}');

      // Create tool outputs for both
      const parentToolOutputDir = path.join(
        toolOutputsDir,
        `session-${parentSessionId}`,
      );
      fs.mkdirSync(parentToolOutputDir, { recursive: true });
      const subagentToolOutputDir = path.join(
        toolOutputsDir,
        `session-${subagentSessionId}`,
      );
      fs.mkdirSync(subagentToolOutputDir, { recursive: true });

      // Call with parent sessionId
      await chatRecordingService.deleteSession(parentSessionId);

      expect(fs.existsSync(parentFile)).toBe(false);
      expect(fs.existsSync(subagentFile)).toBe(false);
      expect(fs.existsSync(subagentDir)).toBe(false); // Subagent directory should be deleted
      expect(fs.existsSync(parentLog)).toBe(false);
      expect(fs.existsSync(subagentLog)).toBe(false);
      expect(fs.existsSync(parentToolOutputDir)).toBe(false);
      expect(fs.existsSync(subagentToolOutputDir)).toBe(false);
    });

    it('should delete subagent files and their logs when parent is deleted (legacy flat structure)', async () => {
      const parentSessionId = '12345678-session-id';
      const shortId = '12345678';
      const subagentSessionId = 'subagent-session-id';
      const chatsDir = path.join(testTempDir, 'chats');
      const logsDir = path.join(testTempDir, 'logs');

      fs.mkdirSync(chatsDir, { recursive: true });
      fs.mkdirSync(logsDir, { recursive: true });

      // Create parent session file
      const parentFile = path.join(
        chatsDir,
        `session-2023-01-01T00-00-${shortId}.jsonl`,
      );
      fs.writeFileSync(
        parentFile,
        JSON.stringify({ sessionId: parentSessionId }) + '\n',
      );

      // Create legacy subagent session file (flat in chatsDir)
      const subagentFile = path.join(
        chatsDir,
        `session-2023-01-01T00-01-${shortId}.jsonl`,
      );
      fs.writeFileSync(
        subagentFile,
        JSON.stringify({ sessionId: subagentSessionId, kind: 'subagent' }) +
          '\n',
      );

      // Call with parent sessionId
      await chatRecordingService.deleteSession(parentSessionId);

      expect(fs.existsSync(parentFile)).toBe(false);
      expect(fs.existsSync(subagentFile)).toBe(false);
    });

    it('should delete by basename', async () => {
      const sessionId = 'test-session-id';
      const shortId = '12345678';
      const chatsDir = path.join(testTempDir, 'chats');
      const logsDir = path.join(testTempDir, 'logs');

      fs.mkdirSync(chatsDir, { recursive: true });
      fs.mkdirSync(logsDir, { recursive: true });

      const basename = `session-2023-01-01T00-00-${shortId}`;
      const sessionFile = path.join(chatsDir, `${basename}.jsonl`);
      fs.writeFileSync(sessionFile, JSON.stringify({ sessionId }) + '\n');

      const logFile = path.join(logsDir, `session-${sessionId}.jsonl`);
      fs.writeFileSync(logFile, '{}');

      // Call with basename
      await chatRecordingService.deleteSession(basename);

      expect(fs.existsSync(sessionFile)).toBe(false);
      expect(fs.existsSync(logFile)).toBe(false);
    });

    it('should not throw if session file does not exist', async () => {
      await expect(
        chatRecordingService.deleteSession('non-existent'),
      ).resolves.not.toThrow();
    });
  });

  describe('deleteCurrentSessionAsync', () => {
    it('should asynchronously delete the current session file and tool outputs', async () => {
      await chatRecordingService.initialize();
      // Record a message to trigger the file write (writeConversation skips
      // writing when there are no messages).
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'test',
        model: 'gemini-pro',
      });
      const conversationFile = chatRecordingService.getConversationFilePath();
      expect(conversationFile).not.toBeNull();

      // Create a tool output directory matching the session ID used by
      // deleteSessionArtifactsAsync (this.sessionId = mockConfig.promptId).
      const toolOutputDir = path.join(
        testTempDir,
        'tool-outputs',
        'session-test-session-id',
      );
      fs.mkdirSync(toolOutputDir, { recursive: true });
      fs.writeFileSync(path.join(toolOutputDir, 'output.txt'), 'data');

      expect(fs.existsSync(conversationFile!)).toBe(true);
      expect(fs.existsSync(toolOutputDir)).toBe(true);

      await chatRecordingService.deleteCurrentSessionAsync();

      expect(fs.existsSync(conversationFile!)).toBe(false);
      expect(fs.existsSync(toolOutputDir)).toBe(false);
    });

    it('should not throw if the session was never initialized', async () => {
      // conversationFile is null when not initialized
      await expect(
        chatRecordingService.deleteCurrentSessionAsync(),
      ).resolves.not.toThrow();
    });

    it('should not throw if session file does not exist on disk', async () => {
      // Lazy persistence: initialize() performs no disk I/O, so the file is
      // already missing; delete it manually anyway to simulate the scenario.
      await chatRecordingService.initialize();
      const conversationFile = chatRecordingService.getConversationFilePath();
      expect(conversationFile).not.toBeNull();
      if (conversationFile && fs.existsSync(conversationFile)) {
        fs.unlinkSync(conversationFile);
      }
      expect(fs.existsSync(conversationFile!)).toBe(false);

      await expect(
        chatRecordingService.deleteCurrentSessionAsync(),
      ).resolves.not.toThrow();
    });

    it('should invalidate the service so records cannot recreate the deleted file', async () => {
      await chatRecordingService.initialize();
      // A real user message materializes the session file.
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'Hello',
        model: 'gemini-pro',
      });
      const conversationFile = chatRecordingService.getConversationFilePath();
      expect(fs.existsSync(conversationFile!)).toBe(true);

      await chatRecordingService.deleteCurrentSessionAsync();

      expect(fs.existsSync(conversationFile!)).toBe(false);
      expect(chatRecordingService.getConversationFilePath()).toBeNull();
      expect(chatRecordingService.getConversation()).toBeNull();

      // A later record (e.g. the UI's "Previous session record deleted." info
      // message recorded right after /clear -d, which still targets the
      // pre-reset service) must NOT recreate the file.
      chatRecordingService.recordMessage({
        model: undefined,
        type: 'info',
        content: 'Previous session record deleted.',
      });
      expect(fs.existsSync(conversationFile!)).toBe(false);
      expect(chatRecordingService.getConversation()).toBeNull();
    });
  });

  describe('recordDirectories', () => {
    beforeEach(async () => {
      await chatRecordingService.initialize();
    });

    it('should save directories to the conversation', async () => {
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'ping',
        model: 'm',
      });
      chatRecordingService.recordDirectories([
        '/path/to/dir1',
        '/path/to/dir2',
      ]);

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      expect(conversation.directories).toEqual([
        '/path/to/dir1',
        '/path/to/dir2',
      ]);
    });

    it('should overwrite existing directories', async () => {
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'ping',
        model: 'm',
      });
      chatRecordingService.recordDirectories(['/old/dir']);
      chatRecordingService.recordDirectories(['/new/dir1', '/new/dir2']);

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      expect(conversation.directories).toEqual(['/new/dir1', '/new/dir2']);
    });
  });

  describe('rewindTo', () => {
    it('should rewind the conversation to a specific message ID', async () => {
      await chatRecordingService.initialize();
      // Record some messages
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'msg1',
        model: 'm',
      });
      chatRecordingService.recordMessage({
        type: 'gemini',
        content: 'msg2',
        model: 'm',
      });
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'msg3',
        model: 'm',
      });

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      let conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      const secondMsgId = conversation.messages[1].id;

      const result = chatRecordingService.rewindTo(secondMsgId);

      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(1);
      expect(result!.messages[0].content).toBe('msg1');

      conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      expect(conversation.messages).toHaveLength(1);
    });

    it('should return the original conversation if the message ID is not found', async () => {
      await chatRecordingService.initialize();
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'msg1',
        model: 'm',
      });

      const result = chatRecordingService.rewindTo('non-existent');

      expect(result).not.toBeNull();
      expect(result!.messages).toHaveLength(1);
    });
  });

  describe('mergeMetadataFrom', () => {
    it('should overlay UI metadata from a source conversation onto matching messages', async () => {
      await chatRecordingService.initialize();

      // Simulate the /fork path: the recording is rebuilt from the bare
      // model-facing history, producing tool calls without UI metadata.
      chatRecordingService.updateMessagesFromHistory([
        {
          id: 'model-1',
          content: {
            role: 'model',
            parts: [
              {
                functionCall: {
                  id: 'call-1',
                  name: 'run_shell_command',
                  args: { command: 'node --version' },
                },
              },
            ],
          },
        },
        {
          id: 'user-1',
          content: {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  id: 'call-1',
                  name: 'run_shell_command',
                  response: { output: 'v22.14.0' },
                },
              },
            ],
          },
        },
      ]);

      const bareMessage = chatRecordingService
        .getConversation()!
        .messages.find(
          (m): m is Extract<MessageRecord, { type: 'gemini' }> =>
            m.type === 'gemini',
        )!;
      expect(bareMessage.toolCalls![0]).toEqual({
        id: 'call-1',
        name: 'run_shell_command',
        args: { command: 'node --version' },
        status: CoreToolCallStatus.Success,
        timestamp: expect.any(String),
      });

      // Source conversation carrying the original UI metadata.
      const sourceMessage: Extract<MessageRecord, { type: 'gemini' }> = {
        ...bareMessage,
        thoughts: [
          {
            subject: '',
            description: 'Checking Node version',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        ],
        tokens: {
          input: 10,
          output: 5,
          cached: 0,
          thoughts: 0,
          tool: 0,
          total: 15,
        },
        model: 'test-model',
        toolCalls: [
          {
            ...bareMessage.toolCalls![0],
            resultDisplay: 'v22.14.0',
            description: 'node --version',
            displayName: 'Shell',
            renderOutputAsMarkdown: false,
          },
        ],
      };
      const source: ConversationRecord = {
        sessionId: 'source',
        projectHash: 'p',
        startTime: '2026-01-01T00:00:00.000Z',
        lastUpdated: '2026-01-01T00:00:00.000Z',
        messages: [sourceMessage],
      };

      chatRecordingService.mergeMetadataFrom(source);

      const mergedMessage = chatRecordingService
        .getConversation()!
        .messages.find(
          (m): m is Extract<MessageRecord, { type: 'gemini' }> =>
            m.type === 'gemini',
        )!;
      expect(mergedMessage.toolCalls![0]).toMatchObject({
        id: 'call-1',
        name: 'run_shell_command',
        args: { command: 'node --version' },
        resultDisplay: 'v22.14.0',
        description: 'node --version',
        displayName: 'Shell',
        renderOutputAsMarkdown: false,
      });
      expect(mergedMessage.thoughts).toEqual(sourceMessage.thoughts);
      expect(mergedMessage.tokens).toEqual(sourceMessage.tokens);
      expect(mergedMessage.model).toBe('test-model');
      // Content stays owned by the current recording.
      expect(mergedMessage.content).toEqual(bareMessage.content);

      // Metadata is persisted to the session file.
      const persisted = (await loadConversationRecord(
        chatRecordingService.getConversationFilePath()!,
      )) as ConversationRecord;
      const persistedMessage = persisted.messages.find(
        (m): m is Extract<MessageRecord, { type: 'gemini' }> =>
          m.type === 'gemini',
      )!;
      expect(persistedMessage.toolCalls![0].resultDisplay).toBe('v22.14.0');
      expect(persistedMessage.thoughts).toEqual(sourceMessage.thoughts);
    });

    it('should ignore non-gemini messages and no-op on a null source', async () => {
      await chatRecordingService.initialize();
      chatRecordingService.updateMessagesFromHistory([
        {
          id: 'model-1',
          content: {
            role: 'model',
            parts: [
              {
                functionCall: {
                  id: 'call-1',
                  name: 'run_shell_command',
                  args: { command: 'node --version' },
                },
              },
            ],
          },
        },
      ]);
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'Hello',
        model: 'm',
      });

      const geminiMessage = chatRecordingService
        .getConversation()!
        .messages.find(
          (m): m is Extract<MessageRecord, { type: 'gemini' }> =>
            m.type === 'gemini',
        )!;
      const source: ConversationRecord = {
        sessionId: 'source',
        projectHash: 'p',
        startTime: '2026-01-01T00:00:00.000Z',
        lastUpdated: '2026-01-01T00:00:00.000Z',
        messages: [
          {
            ...geminiMessage,
            toolCalls: [
              {
                ...geminiMessage.toolCalls![0],
                resultDisplay: 'v22.14.0',
              },
            ],
          },
        ],
      };

      chatRecordingService.mergeMetadataFrom(source);

      const messages = chatRecordingService.getConversation()!.messages;
      // Non-gemini messages are untouched.
      const userMessage = messages.find((m) => m.type === 'user')!;
      expect(userMessage.content).toBe('Hello');
      expect(messages).toHaveLength(2);

      // Null source is a no-op.
      chatRecordingService.mergeMetadataFrom(null);
      expect(chatRecordingService.getConversation()!.messages).toHaveLength(2);
    });
  });

  describe('ENOSPC (disk full) graceful degradation - issue #16266', () => {
    it('should not perform any disk I/O during initialize (lazy persistence)', async () => {
      const mkdirSyncSpy = vi.mocked(fs.mkdirSync);
      const appendFileSyncSpy = vi.mocked(fs.appendFileSync);

      // Should not throw
      await expect(chatRecordingService.initialize()).resolves.not.toThrow();

      // The session file is only materialized once real conversation content
      // arrives; initialize must not touch the disk at all.
      expect(mkdirSyncSpy).not.toHaveBeenCalled();
      expect(appendFileSyncSpy).not.toHaveBeenCalled();

      const conversationFile = chatRecordingService.getConversationFilePath();
      expect(conversationFile).not.toBeNull();
      expect(fs.existsSync(conversationFile!)).toBe(false);
    });

    it('should disable recording and not throw when ENOSPC occurs during writeConversation', async () => {
      await chatRecordingService.initialize();

      const enospcError = new Error('ENOSPC: no space left on device');
      (enospcError as NodeJS.ErrnoException).code = 'ENOSPC';

      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw enospcError;
      });

      // Should not throw when recording a message
      expect(() =>
        chatRecordingService.recordMessage({
          type: 'user',
          content: 'Hello',
          model: 'gemini-pro',
        }),
      ).not.toThrow();

      // Recording should be disabled (conversationFile set to null)
      expect(chatRecordingService.getConversationFilePath()).toBeNull();
    });

    it('should skip recording operations when recording is disabled', async () => {
      await chatRecordingService.initialize();

      const enospcError = new Error('ENOSPC: no space left on device');
      (enospcError as NodeJS.ErrnoException).code = 'ENOSPC';

      const appendFileSyncSpy = vi
        .mocked(fs.appendFileSync)
        .mockImplementationOnce(() => {
          throw enospcError;
        });

      chatRecordingService.recordMessage({
        type: 'user',
        content: 'First message',
        model: 'gemini-pro',
      });

      // Reset mock to track subsequent calls
      appendFileSyncSpy.mockClear();

      // Subsequent calls should be no-ops (not call writeFileSync)
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'Second message',
        model: 'gemini-pro',
      });

      chatRecordingService.recordThought({
        subject: 'Test',
        description: 'Test thought',
      });

      chatRecordingService.saveSummary('Test summary');

      // writeFileSync should not have been called for any of these
      expect(appendFileSyncSpy).not.toHaveBeenCalled();
    });

    it('should return null from getConversation when recording is disabled', async () => {
      await chatRecordingService.initialize();

      const enospcError = new Error('ENOSPC: no space left on device');
      (enospcError as NodeJS.ErrnoException).code = 'ENOSPC';

      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw enospcError;
      });

      // Trigger ENOSPC
      chatRecordingService.recordMessage({
        type: 'user',
        content: 'Hello',
        model: 'gemini-pro',
      });

      // getConversation should return null when disabled
      expect(chatRecordingService.getConversation()).toBeNull();
      expect(chatRecordingService.getConversationFilePath()).toBeNull();
    });

    it('should still throw for non-ENOSPC errors', async () => {
      await chatRecordingService.initialize();

      const otherError = new Error('Permission denied');
      (otherError as NodeJS.ErrnoException).code = 'EACCES';

      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw otherError;
      });

      // Should throw for non-ENOSPC errors
      expect(() =>
        chatRecordingService.recordMessage({
          type: 'user',
          content: 'Hello',
          model: 'gemini-pro',
        }),
      ).toThrow('Permission denied');

      // Recording should NOT be disabled for non-ENOSPC errors (file path still exists)
      expect(chatRecordingService.getConversationFilePath()).not.toBeNull();
    });
  });

  describe('updateMessagesFromHistory', () => {
    beforeEach(async () => {
      await chatRecordingService.initialize();
    });

    it('should record new history turns that are not in the conversation', async () => {
      const appendFileSyncSpy = vi.mocked(fs.appendFileSync);
      appendFileSyncSpy.mockClear();

      const history: HistoryTurn[] = [
        {
          id: 'user-id',
          content: {
            role: 'user',
            parts: [{ text: 'A new user turn' }],
          },
        },
      ];

      chatRecordingService.updateMessagesFromHistory(history);

      // updateMessagesFromHistory ensures all turns in history (including
      // new/synthetic ones) are recorded to disk.
      expect(appendFileSyncSpy).toHaveBeenCalled();

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      expect(conversation.messages).toHaveLength(1);
      expect(conversation.messages[0].id).toBe('user-id');
    });

    it('should deduplicate history turns that share an id', async () => {
      chatRecordingService.recordMessage({
        type: 'gemini',
        content: 'Response with a tool call',
        model: 'gemini-pro',
      });

      // Simulate a polluted checkpoint: the same turn id appears multiple times.
      const history: HistoryTurn[] = [
        {
          id: 'duplicate-turn',
          content: {
            role: 'user',
            parts: [{ text: 'Hello' }],
          },
        },
        {
          id: 'duplicate-turn',
          content: {
            role: 'user',
            parts: [{ text: 'Hello' }],
          },
        },
      ];

      chatRecordingService.updateMessagesFromHistory(history);

      const sessionFile = chatRecordingService.getConversationFilePath()!;
      const conversation = (await loadConversationRecord(
        sessionFile,
      )) as ConversationRecord;
      const duplicates = conversation.messages.filter(
        (m) => m.id === 'duplicate-turn',
      );
      expect(duplicates).toHaveLength(1);
    });

    it('should keep thought and functionCall parts out of synced content', async () => {
      await chatRecordingService.initialize(undefined, 'main');

      // A real model turn is recorded with clean text content plus separate
      // thoughts/toolCalls metadata.
      chatRecordingService.recordThought({
        subject: 'Thinking',
        description: 'Let me check the docs.',
      });
      const id = chatRecordingService.recordMessage({
        model: 'gemini-pro',
        type: 'gemini',
        content: 'Let me check the docs.',
      });
      chatRecordingService.recordToolCalls('gemini-pro', [
        {
          id: 'call-1',
          name: 'read_file',
          args: { filePath: 'README.md' },
          status: CoreToolCallStatus.Success,
          timestamp: new Date().toISOString(),
        },
      ]);

      // Resuming rebuilds the agent history with raw thought/functionCall
      // parts; syncing it back must NOT pollute the durable content.
      const history: HistoryTurn[] = [
        {
          id,
          content: {
            role: 'model',
            parts: [
              { text: '**Thinking** Let me check the docs.', thought: true },
              { text: 'Let me check the docs.' },
              {
                functionCall: {
                  id: 'call-1',
                  name: 'read_file',
                  args: { filePath: 'README.md' },
                },
              },
            ],
          },
        },
      ];
      chatRecordingService.updateMessagesFromHistory(history);

      const record = await loadConversationRecord(
        chatRecordingService.getConversationFilePath()!,
      );
      const modelMsg = record!.messages.find(
        (m) => m.id === id,
      )! as MessageRecord & {
        type: 'gemini';
      };
      // No "[Thought: ...]"/"[Function Call: ...]" labels may ever reach the
      // UI through content — thoughts and tool calls live in their metadata.
      expect(modelMsg.content).toEqual([{ text: 'Let me check the docs.' }]);
      expect(modelMsg.thoughts).toHaveLength(1);
      expect(modelMsg.toolCalls).toHaveLength(1);
    });

    it('should preserve synthetic thought parts that have no thoughts metadata', async () => {
      await chatRecordingService.initialize(undefined, 'main');

      // The binary-ack turn is recorded with a thought part in content and no
      // thoughts metadata; it must survive a history sync unchanged.
      const ackParts = [
        {
          text: 'Binary content received. Proceeding with analysis.',
          thought: true,
        },
      ];
      const id = chatRecordingService.recordSyntheticMessage(
        'gemini',
        ackParts,
      );

      chatRecordingService.updateMessagesFromHistory([
        {
          id,
          content: { role: 'model', parts: ackParts },
        },
      ]);

      const record = await loadConversationRecord(
        chatRecordingService.getConversationFilePath()!,
      );
      const modelMsg = record!.messages.find((m) => m.id === id)!;
      expect(modelMsg.content).toEqual(ackParts);
    });

    it('should extract toolCalls metadata when recording a new model turn from history', async () => {
      await chatRecordingService.initialize(undefined, 'main');

      // A model turn that is new to the recording (e.g. a summary or a turn
      // rebuilt during resume) carries functionCall parts; they must be
      // persisted as toolCalls metadata, not dropped with the content filter.
      const history: HistoryTurn[] = [
        {
          id: 'new-model-turn',
          content: {
            role: 'model',
            parts: [
              { text: 'Calling tools now.' },
              {
                functionCall: {
                  id: 'call-new-1',
                  name: 'read_file',
                  args: { filePath: 'README.md' },
                },
              },
            ],
          },
        },
      ];
      chatRecordingService.updateMessagesFromHistory(history);

      const record = await loadConversationRecord(
        chatRecordingService.getConversationFilePath()!,
      );
      const modelMsg = record!.messages[0] as MessageRecord & {
        type: 'gemini';
      };
      expect(modelMsg.id).toBe('new-model-turn');
      // functionCall parts must not leak into durable content...
      expect(modelMsg.content).toEqual([{ text: 'Calling tools now.' }]);
      // ...but the tool call itself must survive as metadata.
      expect(modelMsg.toolCalls).toEqual([
        expect.objectContaining({
          id: 'call-new-1',
          name: 'read_file',
          args: { filePath: 'README.md' },
          status: CoreToolCallStatus.Success,
        }),
      ]);
    });

    it('should restore toolCalls metadata when the recorded message lacks it', async () => {
      await chatRecordingService.initialize(undefined, 'main');

      // Simulate a legacy/edge recording state: the model text message
      // exists without toolCalls metadata (e.g. data recorded before the
      // single-message-per-turn invariant, or an interrupted stream). The
      // agent-history turn carries the functionCall parts, so a sync must
      // restore the metadata onto the recorded message.
      const id = chatRecordingService.recordMessage({
        model: 'gemini-pro',
        type: 'gemini',
        content: 'I will check the file.',
      });

      // The agent-history turn carries the functionCall parts (as rebuilt
      // after a resume/rewind).
      const history: HistoryTurn[] = [
        {
          id,
          content: {
            role: 'model',
            parts: [
              { text: 'I will check the file.' },
              {
                functionCall: {
                  id: 'call-runtime-1',
                  name: 'read_file',
                  args: { filePath: 'README.md' },
                },
              },
            ],
          },
        },
      ];
      chatRecordingService.updateMessagesFromHistory(history);

      const record = await loadConversationRecord(
        chatRecordingService.getConversationFilePath()!,
      );
      const modelMsg = record!.messages.find(
        (m) => m.id === id,
      )! as MessageRecord & { type: 'gemini' };
      expect(modelMsg.content).toEqual([{ text: 'I will check the file.' }]);
      expect(modelMsg.toolCalls).toEqual([
        expect.objectContaining({
          id: 'call-runtime-1',
          name: 'read_file',
          status: CoreToolCallStatus.Success,
        }),
      ]);
      // The recording must contain exactly one model message (no orphaned
      // tool-call-only duplicate).
      expect(record!.messages.filter((m) => m.type === 'gemini')).toHaveLength(
        1,
      );
    });

    it('should keep tool-call pairing intact after a resume-style rebuild', async () => {
      await chatRecordingService.initialize(undefined, 'main');

      // Build a realistic turn: user asks, model calls a tool, tool responds.
      chatRecordingService.recordMessage({
        model: 'gemini-pro',
        type: 'user',
        content: 'Check the file',
      });
      chatRecordingService.recordMessage({
        model: 'gemini-pro',
        type: 'gemini',
        content: 'Calling read_file.',
      });
      chatRecordingService.recordToolCalls('gemini-pro', [
        {
          id: 'call-pair-1',
          name: 'read_file',
          args: { filePath: 'README.md' },
          status: CoreToolCallStatus.Success,
          timestamp: new Date().toISOString(),
        },
      ]);
      chatRecordingService.recordSyntheticMessage('user', [
        {
          functionResponse: {
            id: 'call-pair-1',
            name: 'read_file',
            response: { output: 'ok' },
          },
        },
      ]);

      // Simulate resume: rebuild the client history from the recording and
      // sync it back (this is what resumeChat/setHistory do).
      const record = await loadConversationRecord(
        chatRecordingService.getConversationFilePath()!,
      );
      const clientHistory = convertSessionToClientHistory(record!.messages);
      chatRecordingService.updateMessagesFromHistory(clientHistory);

      // Rebuild again from the synced recording and convert to the OpenAI
      // format that DeepSeek validates strictly.
      const record2 = await loadConversationRecord(
        chatRecordingService.getConversationFilePath()!,
      );
      const clientHistory2 = convertSessionToClientHistory(record2!.messages);
      const openAiMessages = geminiContentsToOpenAiMessages(
        clientHistory2.map((h) => h.content),
      );

      // Every tool message must be paired with a preceding assistant
      // tool_calls entry — no orphaned tool messages.
      const assistantCallIds = new Set<string>();
      const orphanToolIds: string[] = [];
      for (const msg of openAiMessages) {
        if (msg.role === 'assistant') {
          for (const tc of msg.tool_calls ?? []) {
            assistantCallIds.add(tc.id);
          }
        } else if (msg.role === 'tool') {
          if (!assistantCallIds.has(msg.tool_call_id ?? '')) {
            orphanToolIds.push(msg.tool_call_id ?? '');
          }
        }
      }
      expect(orphanToolIds).toEqual([]);
    });
  });

  describe('ENOENT (missing directory) handling', () => {
    it('should ensure directory exists before writing conversation file', async () => {
      await chatRecordingService.initialize();

      const mkdirSyncSpy = vi.mocked(fs.mkdirSync);
      const appendFileSyncSpy = vi.mocked(fs.appendFileSync);

      chatRecordingService.recordMessage({
        type: 'user',
        content: 'Hello after dir cleanup',
        model: 'gemini-pro',
      });

      // mkdirSync should be called with the parent directory and recursive option
      const conversationFile = chatRecordingService.getConversationFilePath()!;
      expect(mkdirSyncSpy).toHaveBeenCalledWith(
        path.dirname(conversationFile),
        { recursive: true },
      );

      // mkdirSync should be called before writeFileSync
      const mkdirCallOrder = mkdirSyncSpy.mock.invocationCallOrder;
      const writeCallOrder = appendFileSyncSpy.mock.invocationCallOrder;
      const lastMkdir = mkdirCallOrder[mkdirCallOrder.length - 1];
      const lastWrite = writeCallOrder[writeCallOrder.length - 1];
      expect(lastMkdir).toBeLessThan(lastWrite);

      mkdirSyncSpy.mockRestore();
    });
  });

  describe('recordSyntheticMessage and history sync', () => {
    it('should correctly record synthetic messages with durable IDs', async () => {
      await chatRecordingService.initialize(undefined, 'main');
      const parts = [{ text: 'Synthetic Turn' }];

      // Implicit ID generation
      const id1 = chatRecordingService.recordSyntheticMessage('user', parts);
      expect(id1).toBeDefined();
      expect(id1).toMatch(/test-uuid-/);

      // Explicit ID registration (e.g. from context processor)
      const customId = 'stable-hash-123';
      const id2 = chatRecordingService.recordSyntheticMessage(
        'gemini',
        parts,
        customId,
      );
      expect(id2).toBe(customId);

      const record = await loadConversationRecord(
        chatRecordingService.getConversationFilePath()!,
      );
      expect(record!.messages).toHaveLength(2);
      expect(record!.messages[0].id).toBe(id1);
      expect(record!.messages[0].type).toBe('user');
      expect(record!.messages[1].id).toBe(customId);
      expect(record!.messages[1].type).toBe('gemini');
    });

    it('should synchronize history turns and maintain their durable identity', async () => {
      await chatRecordingService.initialize(undefined, 'main');
      const history: HistoryTurn[] = [
        { id: 'h1', content: { role: 'user', parts: [{ text: 'msg1' }] } },
        { id: 'h2', content: { role: 'model', parts: [{ text: 'msg2' }] } },
      ];

      chatRecordingService.updateMessagesFromHistory(history);

      const record = await loadConversationRecord(
        chatRecordingService.getConversationFilePath()!,
      );
      expect(record!.messages).toHaveLength(2);
      expect(record!.messages[0].id).toBe('h1');
      expect(record!.messages[1].id).toBe('h2');

      // Update with a summary
      const summaryId = 'summary-123';
      const updatedHistory: HistoryTurn[] = [
        {
          id: summaryId,
          content: { role: 'user', parts: [{ text: 'summary' }] },
        },
        ...history.slice(1),
      ];

      chatRecordingService.updateMessagesFromHistory(updatedHistory);
      const record2 = await loadConversationRecord(
        chatRecordingService.getConversationFilePath()!,
      );
      expect(record2!.messages).toHaveLength(2);
      expect(record2!.messages[0].id).toBe(summaryId);
      expect(record2!.messages[1].id).toBe('h2');
    });
  });
});
