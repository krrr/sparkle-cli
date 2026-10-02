/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { SlashCommand, CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { Content } from '@google/genai';
import {
  ProviderType,
  type GeminiClient,
  uiTelemetryService,
  type HistoryTurn,
  type ConversationRecord,
} from 'sparkle-cli-core';

import * as fsPromises from 'node:fs/promises';
import { debugCommand, chatCommand } from './chatCommand.js';
import {
  serializeHistoryToMarkdown,
  exportHistoryToFile,
} from '../utils/historyExportUtils.js';
import { SessionSelector } from '../../utils/sessionUtils.js';
import path from 'node:path';

vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  readdir: vi.fn().mockResolvedValue(['file1.txt', 'file2.txt'] as string[]),
  writeFile: vi.fn(),
}));

vi.mock('../utils/historyExportUtils.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../utils/historyExportUtils.js')>();
  return {
    ...actual,
    exportHistoryToFile: vi.fn(),
  };
});

vi.mock('../../utils/sessionUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/sessionUtils.js')>();
  return {
    ...actual,
    SessionSelector: vi.fn(),
  };
});

describe('chatCommand', () => {
  const mockFs = vi.mocked(fsPromises);
  const mockExport = vi.mocked(exportHistoryToFile);

  let mockContext: CommandContext;
  let mockGetChat: ReturnType<typeof vi.fn>;
  let mockGetHistory: ReturnType<typeof vi.fn>;

  const getSubCommand = (name: 'export' | 'dump' | 'fork'): SlashCommand => {
    const subCommand = chatCommand.subCommands?.find((cmd) => cmd.name === name);
    if (!subCommand) {
      throw new Error(`/chat ${name} command not found.`);
    }
    return subCommand;
  };

  beforeEach(() => {
    mockGetHistory = vi.fn().mockReturnValue([]);
    mockGetChat = vi.fn().mockReturnValue({
      getHistory: mockGetHistory,
      getDurableHistoryTurns: mockGetHistory,
    });

    mockContext = createMockCommandContext({
      services: {
        agentContext: {
          config: {
            getProjectRoot: () => '/project/root',
            getContentGeneratorConfig: () => ({
              authType: ProviderType.USE_GEMINI,
            }),
            storage: {
              getProjectTempDir: () => '/project/root/.sparkle/tmp/mockhash',
              getProjectDataDir: () => '/project/root/.sparkle/data/mockhash',
            },
          },
          geminiClient: {
            getChat: mockGetChat,
          } as unknown as GeminiClient,
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should open the session browser for bare /chat', async () => {
    const result = await chatCommand.action?.({} as CommandContext, '');
    expect(result).toEqual({
      type: 'dialog',
      dialog: 'sessionBrowser',
    });
  });

  it('should have the correct main command definition', () => {
    expect(chatCommand.name).toBe('chat');
    expect(chatCommand.altNames).toContain('resume');
    expect(chatCommand.description).toBe('Browse auto-saved conversations');
    expect(chatCommand.autoExecute).toBe(true);
    expect(chatCommand.subCommands).toHaveLength(3);
  });

  it('should expose unified chat subcommands directly under /chat', () => {
    const visibleSubCommandNames = (chatCommand.subCommands ?? [])
      .filter((subCommand) => !subCommand.hidden)
      .map((subCommand) => subCommand.name);

    expect(visibleSubCommandNames).toEqual(['export', 'dump', 'fork']);
  });

  describe('export subcommand', () => {
    let exportCommand: SlashCommand;
    const mockHistory = [
      { role: 'user', parts: [{ text: 'context' }] },
      { role: 'model', parts: [{ text: 'context response' }] },
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi there!' }] },
    ];

    beforeEach(() => {
      exportCommand = getSubCommand('export');
      vi.spyOn(process, 'cwd').mockReturnValue(
        path.resolve('/usr/local/google/home/myuser/sparkle-cli'),
      );
      vi.spyOn(Date, 'now').mockReturnValue(1234567890);
      mockGetHistory.mockReturnValue(mockHistory);
      mockFs.writeFile.mockClear();
    });

    it('should default to a json file if no path is provided', async () => {
      const result = await exportCommand?.action?.(mockContext, '');
      const expectedPath = path.join(
        process.cwd(),
        'sparkle-conversation-1234567890.json',
      );
      expect(mockExport).toHaveBeenCalledWith({
        history: mockHistory,
        filePath: expectedPath,
      });
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: `Conversation exported to ${expectedPath}`,
      });
    });

    it('should export the conversation to a JSON file', async () => {
      const filePath = 'my-chat.json';
      const result = await exportCommand?.action?.(mockContext, filePath);
      const expectedPath = path.join(process.cwd(), 'my-chat.json');
      expect(mockExport).toHaveBeenCalledWith({
        history: mockHistory,
        filePath: expectedPath,
      });
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: `Conversation exported to ${expectedPath}`,
      });
    });

    it('should export the conversation to a Markdown file', async () => {
      const filePath = 'my-chat.md';
      const result = await exportCommand?.action?.(mockContext, filePath);
      const expectedPath = path.join(process.cwd(), 'my-chat.md');
      expect(mockExport).toHaveBeenCalledWith({
        history: mockHistory,
        filePath: expectedPath,
      });
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: `Conversation exported to ${expectedPath}`,
      });
    });

    it('should return an error for unsupported file extensions', async () => {
      const filePath = 'my-chat.txt';
      const result = await exportCommand?.action?.(mockContext, filePath);
      expect(mockExport).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Invalid file format. Only .md and .json are supported.',
      });
    });

    it('should inform if there is no conversation to export', async () => {
      mockGetHistory.mockReturnValue([{ role: 'user', parts: [{ text: 'context' }] }]);
      const result = await exportCommand?.action?.(mockContext, 'my-chat.json');
      expect(mockExport).not.toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to export.',
      });
    });

    it('should handle errors during file writing', async () => {
      const error = new Error('Permission denied');
      mockExport.mockRejectedValue(error);
      const result = await exportCommand?.action?.(mockContext, 'my-chat.json');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: `Error exporting conversation: ${error.message}`,
      });
    });

    it('should output valid JSON schema', async () => {
      const filePath = 'my-chat.json';
      await exportCommand?.action?.(mockContext, filePath);
      const expectedPath = path.join(process.cwd(), 'my-chat.json');
      expect(mockExport).toHaveBeenCalledWith({
        history: mockHistory,
        filePath: expectedPath,
      });
    });

    it('should output correct markdown format', async () => {
      const filePath = 'my-chat.md';
      await exportCommand?.action?.(mockContext, filePath);
      const expectedPath = path.join(process.cwd(), 'my-chat.md');
      expect(mockExport).toHaveBeenCalledWith({
        history: mockHistory,
        filePath: expectedPath,
      });
    });
  });

  describe('dump subcommand', () => {
    let dumpCommand: SlashCommand;
    let mockResolveSession: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      dumpCommand = getSubCommand('dump');
      mockResolveSession = vi.fn();
      vi.mocked(SessionSelector).mockReturnValue({
        resolveSession: mockResolveSession,
      } as unknown as SessionSelector);
      mockContext.services.agentContext!.config.getSessionId = () => 'test-session-id';
      vi.spyOn(process, 'cwd').mockReturnValue('/project/root');
      mockFs.writeFile.mockClear();
    });

    it('should return error if no path is provided', async () => {
      const result = await dumpCommand.action!(mockContext, '   ');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: expect.stringContaining('Please provide a file path'),
      });
      expect(mockResolveSession).not.toHaveBeenCalled();
    });

    it('should return error if sessionId is missing', async () => {
      mockContext.services.agentContext!.config.getSessionId = () =>
        undefined as unknown as string;

      const result = await dumpCommand.action!(mockContext, 'dump.json');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'No active session found to dump.',
      });
      expect(mockResolveSession).not.toHaveBeenCalled();
    });

    it('should dump the session successfully', async () => {
      const mockSessionData = {
        sessionId: 'test-session-id',
        messages: [],
        projectHash: 'hash',
        startTime: 'time',
        lastUpdated: 'time',
      };
      mockResolveSession.mockResolvedValue({
        sessionData: mockSessionData,
        sessionPath: path.join(path.sep, 'tmp', 'mock-dir', 'chats', 'session.jsonl'),
        displayInfo: 'test',
      });

      const result = await dumpCommand.action!(mockContext, '  dump.json  ');

      expect(result).toBeUndefined();
      expect(mockResolveSession).toHaveBeenCalledWith('test-session-id');
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        path.resolve('/project/root', 'dump.json'),
        JSON.stringify(mockSessionData, null, 2),
        'utf-8',
      );
      expect(mockContext.ui.setPendingItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'export_session',
          exportSession: { isPending: true },
        }),
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'export_session',
          exportSession: {
            isPending: false,
            targetPath: expect.stringContaining('dump.json'),
          },
        }),
        expect.any(Number),
      );
      expect(mockContext.ui.setPendingItem).toHaveBeenLastCalledWith(null);
    });

    it('should return error if resolveSession fails', async () => {
      mockResolveSession.mockRejectedValue(new Error('Session not found'));

      const result = await dumpCommand.action!(mockContext, 'dump.json');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed to dump session: Session not found',
      });
      expect(mockContext.ui.setPendingItem).toHaveBeenLastCalledWith(null);
    });
  });

  describe('fork subcommand', () => {
    let forkCommand: SlashCommand;
    const mockHistory: HistoryTurn[] = [
      { id: 'env', content: { role: 'user', parts: [{ text: 'context' }] } },
      {
        id: 'model-1',
        content: { role: 'model', parts: [{ text: 'context response' }] },
      },
      { id: 'user-1', content: { role: 'user', parts: [{ text: 'Hello' }] } },
      {
        id: 'model-2',
        content: { role: 'model', parts: [{ text: 'Hi there!' }] },
      },
    ];

    let mockResetChat: ReturnType<typeof vi.fn>;
    let mockResetNewSessionState: ReturnType<typeof vi.fn>;
    let mockRefreshMemory: ReturnType<typeof vi.fn>;
    let mockSaveSummary: ReturnType<typeof vi.fn>;
    let mockGetConversation: ReturnType<typeof vi.fn>;
    let mockMergeMetadataFrom: ReturnType<typeof vi.fn>;
    let mockClearInjections: ReturnType<typeof vi.fn>;
    let mockClearTelemetry: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      forkCommand = getSubCommand('fork');
      mockResetChat = vi.fn().mockResolvedValue(undefined);
      mockResetNewSessionState = vi.fn();
      mockRefreshMemory = vi.fn().mockResolvedValue(undefined);
      mockSaveSummary = vi.fn();
      mockGetConversation = vi.fn().mockReturnValue(null);
      mockMergeMetadataFrom = vi.fn();
      mockClearInjections = vi.fn();
      mockClearTelemetry = vi.spyOn(uiTelemetryService, 'clear');
      mockGetHistory.mockReturnValue(mockHistory);

      mockContext.services.agentContext = {
        config: {
          resetNewSessionState: mockResetNewSessionState,
          injectionService: {
            clear: mockClearInjections,
          },
          getMemoryContextManager: () => ({ refresh: mockRefreshMemory }),
        },
        geminiClient: {
          getChat: mockGetChat,
          resetChat: mockResetChat,
          getChatRecordingService: () => ({
            getConversation: mockGetConversation,
            mergeMetadataFrom: mockMergeMetadataFrom,
            saveSummary: mockSaveSummary,
          }),
        } as unknown as GeminiClient,
      } as unknown as CommandContext['services']['agentContext'];
      mockContext.ui.clear = vi.fn();
      mockContext.ui.loadHistory = vi.fn();
    });

    it('should error if there is no chat client', async () => {
      mockContext.services.agentContext = null;
      const result = await forkCommand?.action?.(mockContext, '');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'No chat client available to fork conversation.',
      });
    });

    it('should inform if there is no conversation to fork', async () => {
      mockGetHistory.mockReturnValue([
        { id: 'env', content: { role: 'user', parts: [{ text: 'context' }] } },
      ]);
      const result = await forkCommand?.action?.(mockContext, '');
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to fork.',
      });
      expect(mockResetChat).not.toHaveBeenCalled();
    });

    it('should fork the conversation into a new session', async () => {
      const result = await forkCommand?.action?.(mockContext, '');

      expect(mockClearInjections).toHaveBeenCalled();
      expect(mockResetNewSessionState).toHaveBeenCalledWith(expect.any(String));
      expect(mockClearTelemetry).toHaveBeenCalledWith(expect.any(String));
      expect(mockResetChat).toHaveBeenCalledWith(mockHistory);
      expect(mockMergeMetadataFrom).toHaveBeenCalledWith(null);
      expect(mockSaveSummary).toHaveBeenCalledWith('Fork: Hello');
      expect(mockContext.ui.loadHistory).toHaveBeenCalledWith([
        { id: 1, type: 'gemini', text: 'context response' },
        { id: 2, type: 'user', text: 'Hello' },
        { id: 3, type: 'gemini', text: 'Hi there!' },
      ]);
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'Conversation forked into a new session.',
      });
    });

    it('should restore the original UI metadata onto the forked session', async () => {
      const sourceConversation = {
        sessionId: 'source',
        projectHash: 'p',
        startTime: '2026-01-01T00:00:00.000Z',
        lastUpdated: '2026-01-01T00:00:00.000Z',
        messages: [],
        summary: 'Original summary',
      } as unknown as ConversationRecord;
      mockGetConversation.mockReturnValue(sourceConversation);

      await forkCommand?.action?.(mockContext, '');

      expect(mockMergeMetadataFrom).toHaveBeenCalledWith(sourceConversation);
      expect(mockSaveSummary).toHaveBeenCalledWith('Fork: Original summary');
    });

    it('should render tool groups in the live transcript from the source recording', async () => {
      const sourceConversation = {
        sessionId: 'source',
        projectHash: 'p',
        startTime: '2026-01-01T00:00:00.000Z',
        lastUpdated: '2026-01-01T00:00:00.000Z',
        summary: 'Original summary',
        messages: [
          {
            id: 'm1',
            timestamp: '2026-01-01T00:00:00.000Z',
            type: 'gemini',
            content: 'Hi there!',
            model: 'test-model',
            toolCalls: [
              {
                id: 'c1',
                name: 'run_shell_command',
                args: { command: 'node --version' },
                status: 'success',
                timestamp: '2026-01-01T00:00:00.000Z',
                displayName: 'Shell',
                description: 'node --version',
              },
            ],
          },
        ],
      } as unknown as ConversationRecord;
      mockGetConversation.mockReturnValue(sourceConversation);

      await forkCommand?.action?.(mockContext, '');

      expect(mockContext.ui.loadHistory).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ type: 'tool_group' })]),
      );
    });

    it('should report an error if resetting the new chat fails', async () => {
      mockResetChat.mockRejectedValue(new Error('boom'));
      const result = await forkCommand?.action?.(mockContext, '');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Error forking conversation: boom',
      });
    });

    it('should use a fallback summary label when there is no user text', async () => {
      mockGetHistory.mockReturnValue([
        { id: 'env', content: { role: 'user', parts: [{ text: 'context' }] } },
        {
          id: 'model-1',
          content: { role: 'model', parts: [{ text: 'response' }] },
        },
      ]);
      await forkCommand?.action?.(mockContext, '');
      expect(mockSaveSummary).toHaveBeenCalledWith('Fork: Untitled');
    });

    it('should prefer the original session summary over the first user message', async () => {
      mockGetConversation.mockReturnValue({ summary: 'Add dark mode' });
      await forkCommand?.action?.(mockContext, '');
      expect(mockSaveSummary).toHaveBeenCalledWith('Fork: Add dark mode');
    });

    it('should correctly process HistoryTurn objects from getDurableHistoryTurns', async () => {
      const historyTurns = [
        {
          id: 'env-1',
          content: {
            role: 'user',
            parts: [{ text: '<session_context>initial</session_context>' }],
          },
        },
        {
          id: 'turn-1',
          content: { role: 'user', parts: [{ text: 'User prompt' }] },
        },
        {
          id: 'turn-2',
          content: { role: 'model', parts: [{ text: 'Model reply' }] },
        },
      ];
      mockGetHistory.mockReturnValue(historyTurns);

      await forkCommand?.action?.(mockContext, '');

      expect(mockResetChat).toHaveBeenCalledWith(historyTurns);
      expect(mockSaveSummary).toHaveBeenCalledWith('Fork: User prompt');
      expect(mockContext.ui.loadHistory).toHaveBeenCalledWith([
        { id: 1, type: 'user', text: 'User prompt' },
        { id: 2, type: 'gemini', text: 'Model reply' },
      ]);
    });
  });

  describe('serializeHistoryToMarkdown', () => {
    it('should correctly serialize chat history to Markdown with icons', () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi there!' }] },
        { role: 'user', parts: [{ text: 'How are you?' }] },
      ];

      const expectedMarkdown =
        '## USER 🧑‍💻\n\nHello\n\n---\n\n' +
        '## MODEL ✨\n\nHi there!\n\n---\n\n' +
        '## USER 🧑‍💻\n\nHow are you?';

      const result = serializeHistoryToMarkdown(history);
      expect(result).toBe(expectedMarkdown);
    });

    it('should handle empty history', () => {
      const history: Content[] = [];
      const result = serializeHistoryToMarkdown(history);
      expect(result).toBe('');
    });

    it('should handle items with no text parts', () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [] },
        { role: 'user', parts: [{ text: 'How are you?' }] },
      ];

      const expectedMarkdown = `## USER 🧑‍💻

Hello

---

## MODEL ✨



---

## USER 🧑‍💻

How are you?`;

      const result = serializeHistoryToMarkdown(history);
      expect(result).toBe(expectedMarkdown);
    });

    it('should correctly serialize function calls and responses', () => {
      const history: Content[] = [
        {
          role: 'user',
          parts: [{ text: 'Please call a function.' }],
        },
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'my-function',
                args: { arg1: 'value1' },
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'my-function',
                response: { result: 'success' },
              },
            },
          ],
        },
      ];

      const expectedMarkdown = `## USER 🧑‍💻

Please call a function.

---

## MODEL ✨

**Tool Command**:
\`\`\`json
{
  "name": "my-function",
  "args": {
    "arg1": "value1"
  }
}
\`\`\`

---

## USER 🧑‍💻

**Tool Response**:
\`\`\`json
{
  "name": "my-function",
  "response": {
    "result": "success"
  }
}
\`\`\``;

      const result = serializeHistoryToMarkdown(history);
      expect(result).toBe(expectedMarkdown);
    });

    it('should handle items with undefined role', () => {
      const history: Array<Partial<Content>> = [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { parts: [{ text: 'Hi there!' }] },
      ];

      const expectedMarkdown = `## USER 🧑‍💻

Hello

---

## MODEL ✨

Hi there!`;

      const result = serializeHistoryToMarkdown(history as Content[]);
      expect(result).toBe(expectedMarkdown);
    });
  });

  describe('debug subcommand', () => {
    let mockGetLatestApiRequest: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockGetLatestApiRequest = vi.fn();
      if (!mockContext.services.agentContext!.config) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockContext.services.agentContext!.config as any) = {};
      }
      mockContext.services.agentContext!.config.getLatestApiRequest =
        mockGetLatestApiRequest;
      vi.spyOn(process, 'cwd').mockReturnValue('/project/root');
      vi.spyOn(Date, 'now').mockReturnValue(1234567890);
      mockFs.writeFile.mockClear();
    });

    it('should return an error if no API request is found', async () => {
      mockGetLatestApiRequest.mockReturnValue(undefined);

      const result = await debugCommand.action?.(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'No recent API request found to export.',
      });
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('should convert and write the API request to a json file', async () => {
      const mockRequest = {
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      };
      mockGetLatestApiRequest.mockReturnValue(mockRequest);

      const result = await debugCommand.action?.(mockContext, '');

      const expectedFilename = 'gcli-request-1234567890.json';
      const expectedPath = path.join('/project/root', expectedFilename);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expectedPath,
        expect.stringContaining('"role": "user"'),
      );
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: `Debug API request saved to ${expectedFilename}`,
      });
    });

    it('should handle errors during file write', async () => {
      const mockRequest = { contents: [] };
      mockGetLatestApiRequest.mockReturnValue(mockRequest);
      mockFs.writeFile.mockRejectedValue(new Error('Write failed'));

      const result = await debugCommand.action?.(mockContext, '');

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Error saving debug request: Write failed',
      });
    });
  });
});
