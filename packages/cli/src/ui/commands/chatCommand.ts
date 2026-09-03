/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsPromises from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import React from 'react';
import { Text } from 'ink';
import { theme } from '../semantic-colors.js';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
  OpenDialogActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import {
  decodeTagName,
  type MessageActionReturn,
  INITIAL_HISTORY_LENGTH,
  uiTelemetryService,
  type HistoryTurn,
} from 'sparkle-cli-core';
import type { Content } from '@google/genai';
import path from 'node:path';
import type {
  HistoryItemWithoutId,
  HistoryItemChatList,
  ChatDetail,
  HistoryItem,
} from '../types.js';
import { MessageType } from '../types.js';
import { exportHistoryToFile } from '../utils/historyExportUtils.js';
import { convertToRestPayload } from 'sparkle-cli-core';

const CHECKPOINT_MENU_GROUP = 'checkpoints';

const getSavedChatTags = async (
  context: CommandContext,
  mtSortDesc: boolean,
): Promise<ChatDetail[]> => {
  const cfg = context.services.agentContext?.config;
  const geminiDir = cfg?.storage?.getProjectDataDir();
  if (!geminiDir) {
    return [];
  }
  try {
    const file_head = 'checkpoint-';
    const file_tail = '.json';
    const files = await fsPromises.readdir(geminiDir);
    const chatDetails: ChatDetail[] = [];

    for (const file of files) {
      if (file.startsWith(file_head) && file.endsWith(file_tail)) {
        const filePath = path.join(geminiDir, file);
        const stats = await fsPromises.stat(filePath);
        const tagName = file.slice(file_head.length, -file_tail.length);
        chatDetails.push({
          name: decodeTagName(tagName),
          mtime: stats.mtime.toISOString(),
        });
      }
    }

    chatDetails.sort((a, b) =>
      mtSortDesc
        ? b.mtime.localeCompare(a.mtime)
        : a.mtime.localeCompare(b.mtime),
    );

    return chatDetails;
  } catch {
    return [];
  }
};

const listCommand: SlashCommand = {
  name: 'list',
  description: 'List saved manual conversation checkpoints',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  takesArgs: false,
  action: async (context): Promise<void> => {
    const chatDetails = await getSavedChatTags(context, false);

    const item: HistoryItemChatList = {
      type: MessageType.CHAT_LIST,
      chats: chatDetails,
    };

    context.ui.addItem(item);
  },
};

const saveCommand: SlashCommand = {
  name: 'save',
  description:
    'Save the current conversation as a checkpoint. Usage: /chat save <tag>',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context, args): Promise<SlashCommandActionReturn | void> => {
    const tag = args.trim();
    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat save <tag>',
      };
    }

    const { logger } = context.services;
    const config = context.services.agentContext?.config;
    await logger.initialize();

    if (!context.overwriteConfirmed) {
      const exists = await logger.checkpointExists(tag);
      if (exists) {
        return {
          type: 'confirm_action',
          prompt: React.createElement(
            Text,
            null,
            'A checkpoint with the tag ',
            React.createElement(Text, { color: theme.text.accent }, tag),
            ' already exists. Do you want to overwrite it?',
          ),
          originalInvocation: {
            raw: context.invocation?.raw || `/chat save ${tag}`,
          },
        };
      }
    }

    const chat = context.services.agentContext?.geminiClient?.getChat();
    if (!chat) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No chat client available to save conversation.',
      };
    }

    const history = chat.getDurableHistoryTurns().map((t) => t.content);
    if (history.length > INITIAL_HISTORY_LENGTH) {
      const authType = config?.getContentGeneratorConfig()?.authType;
      await logger.saveCheckpoint({ history, authType }, tag);
      return {
        type: 'message',
        messageType: 'info',
        content: `Conversation checkpoint saved with tag: ${decodeTagName(
          tag,
        )}.`,
      };
    } else {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to save.',
      };
    }
  },
};

function convertContentHistoryToUiHistory(
  history: ReadonlyArray<Content | HistoryTurn>,
): HistoryItemWithoutId[] {
  const rolemap: Record<string, MessageType> = {
    user: MessageType.USER,
    model: MessageType.GEMINI,
  };

  const uiHistory: HistoryItemWithoutId[] = [];

  for (const rawItem of history.slice(INITIAL_HISTORY_LENGTH)) {
    const item = 'content' in rawItem ? rawItem.content : rawItem;
    // Exclude thought parts (they carry `thought` and must not render as
    // message text) and function call parts (they have no text and are
    // shown via tool groups instead).
    const text =
      item.parts
        ?.filter((m) => !!m.text && !m.thought)
        .map((m) => m.text)
        .join('') || '';
    if (!text) {
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    uiHistory.push({
      type: (item.role && rolemap[item.role]) || MessageType.GEMINI,
      text,
    } as HistoryItemWithoutId);
  }

  return uiHistory;
}

const resumeCheckpointCommand: SlashCommand = {
  name: 'resume',
  altNames: ['load'],
  description:
    'Resume a conversation from a checkpoint. Usage: /chat resume <tag>',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, args) => {
    const tag = args.trim();
    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat resume <tag>',
      };
    }

    const { logger } = context.services;
    const config = context.services.agentContext?.config;
    await logger.initialize();
    const checkpoint = await logger.loadCheckpoint(tag);
    const conversation = checkpoint.history;

    if (conversation.length === 0) {
      return {
        type: 'message',
        messageType: 'info',
        content: `No saved checkpoint found with tag: ${decodeTagName(tag)}.`,
      };
    }

    const currentAuthType = config?.getContentGeneratorConfig()?.authType;
    if (
      checkpoint.authType &&
      currentAuthType &&
      checkpoint.authType !== currentAuthType
    ) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Cannot resume chat. It was saved with a different authentication method (${checkpoint.authType}) than the current one (${currentAuthType}).`,
      };
    }

    const uiHistory = convertContentHistoryToUiHistory(conversation);
    return {
      type: 'load_history',
      history: uiHistory,
      clientHistory: conversation,
    };
  },
  completion: async (context, partialArg) => {
    const chatDetails = await getSavedChatTags(context, true);
    return chatDetails
      .map((chat) => chat.name)
      .filter((name) => name.startsWith(partialArg));
  },
};

const deleteCommand: SlashCommand = {
  name: 'delete',
  description: 'Delete a conversation checkpoint. Usage: /chat delete <tag>',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, args): Promise<MessageActionReturn> => {
    const tag = args.trim();
    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat delete <tag>',
      };
    }

    const { logger } = context.services;
    await logger.initialize();
    const deleted = await logger.deleteCheckpoint(tag);

    if (deleted) {
      return {
        type: 'message',
        messageType: 'info',
        content: `Conversation checkpoint '${decodeTagName(tag)}' has been deleted.`,
      };
    } else {
      return {
        type: 'message',
        messageType: 'error',
        content: `Error: No checkpoint found with tag '${decodeTagName(tag)}'.`,
      };
    }
  },
  completion: async (context, partialArg) => {
    const chatDetails = await getSavedChatTags(context, true);
    return chatDetails
      .map((chat) => chat.name)
      .filter((name) => name.startsWith(partialArg));
  },
};

const shareCommand: SlashCommand = {
  name: 'share',
  description:
    'Share the current conversation to a markdown or json file. Usage: /chat share <file>',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context, args): Promise<MessageActionReturn> => {
    let filePathArg = args.trim();
    if (!filePathArg) {
      filePathArg = `sparkle-conversation-${Date.now()}.json`;
    }

    const filePath = path.resolve(filePathArg);
    const extension = path.extname(filePath);
    if (extension !== '.md' && extension !== '.json') {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Invalid file format. Only .md and .json are supported.',
      };
    }

    const chat = context.services.agentContext?.geminiClient?.getChat();
    if (!chat) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No chat client available to share conversation.',
      };
    }

    const history = chat.getHistory();

    // An empty conversation has a hidden message that sets up the context for
    // the chat. Thus, to check whether a conversation has been started, we
    // can't check for length 0.
    if (history.length <= INITIAL_HISTORY_LENGTH) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to share.',
      };
    }

    try {
      await exportHistoryToFile({ history, filePath });
      return {
        type: 'message',
        messageType: 'info',
        content: `Conversation shared to ${filePath}`,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        type: 'message',
        messageType: 'error',
        content: `Error sharing conversation: ${errorMessage}`,
      };
    }
  },
};

export const debugCommand: SlashCommand = {
  name: 'debug',
  description: 'Export the most recent API request as a JSON payload',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context): Promise<MessageActionReturn> => {
    const req = context.services.agentContext?.config.getLatestApiRequest();
    if (!req) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No recent API request found to export.',
      };
    }

    const restPayload = convertToRestPayload(req);
    const filename = `gcli-request-${Date.now()}.json`;
    const filePath = path.join(process.cwd(), filename);

    try {
      await fsPromises.writeFile(
        filePath,
        JSON.stringify(restPayload, null, 2),
      );
      return {
        type: 'message',
        messageType: 'info',
        content: `Debug API request saved to ${filename}`,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        type: 'message',
        messageType: 'error',
        content: `Error saving debug request: ${errorMessage}`,
      };
    }
  },
};

const forkCommand: SlashCommand = {
  name: 'fork',
  description: 'Duplicate the current conversation into a new session',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  takesArgs: false,
  action: async (context): Promise<MessageActionReturn | void> => {
    const geminiClient = context.services.agentContext?.geminiClient;
    const config = context.services.agentContext?.config;
    const chat = geminiClient?.getChat();
    if (!geminiClient || !chat) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No chat client available to fork conversation.',
      };
    }

    const history = chat.getDurableHistoryTurns();

    // An empty conversation has a hidden message that sets up the context for
    // the chat. Thus, to check whether a conversation has been started, we
    // can't check for length 0.
    if (history.length <= INITIAL_HISTORY_LENGTH) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to fork.',
      };
    }

    try {
      // Derive a distinguishing label for the forked session. Prefer the
      // original session's existing summary, otherwise fall back to the
      // copied history's first user turn (mirrors how SessionBrowser builds
      // a display name). This becomes the new session's summary so the fork
      // is distinguishable from the original in the session browser.
      const originalRecord = geminiClient
        .getChatRecordingService()
        ?.getConversation();
      let forkSourceName = '';
      if (originalRecord?.summary) {
        forkSourceName = originalRecord.summary;
      } else {
        for (const turn of history.slice(INITIAL_HISTORY_LENGTH)) {
          if (turn.content.role === 'user') {
            const text =
              turn.content.parts
                ?.filter((m) => !!m.text && !m.thought)
                .map((m) => m.text)
                .join('') || '';
            if (text) {
              forkSourceName = text.replace(/\s+/g, ' ').trim();
              break;
            }
          }
        }
      }
      const forkSummary = `Fork: ${forkSourceName || 'Untitled'}`.slice(0, 200);

      // Clear any pending user steering hints
      config?.injectionService?.clear();

      // Start a new conversation recording with a new session ID. We must
      // reset the session state BEFORE calling startChat so the new
      // ChatRecordingService initialized by GeminiChat picks up the new id.
      const newSessionId = randomUUID();
      config?.resetNewSessionState(newSessionId);
      uiTelemetryService.clear(newSessionId);

      // Creating a new chat with the current history also creates a new
      // persistent session file under the new session id.
      await geminiClient.startChat([...history]);

      // Persist the distinguishing summary. AI summary generation skips
      // sessions that already have a summary, so this is stable.
      geminiClient.getChatRecordingService()?.saveSummary(forkSummary);

      // Reset the JIT context manager so subdirectory context is discovered
      // for the new session.
      await config?.getMemoryContextManager()?.refresh();

      // Rebuild the UI history from the copied conversation, mirroring what
      // resume does so thought/functionCall parts are excluded.
      const rawUiHistory = convertContentHistoryToUiHistory(history);
      const uiHistory: HistoryItem[] = rawUiHistory.map((item, index) => ({
        ...item,
        id: index + 1,
      }));

      context.ui.clear();
      context.ui.loadHistory(uiHistory);

      return {
        type: 'message',
        messageType: 'info',
        content: 'Conversation forked into a new session.',
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        type: 'message',
        messageType: 'error',
        content: `Error forking conversation: ${errorMessage}`,
      };
    }
  },
};

export const checkpointSubCommands: SlashCommand[] = [
  listCommand,
  saveCommand,
  resumeCheckpointCommand,
  deleteCommand,
  shareCommand,
];

const checkpointCompatibilityCommand: SlashCommand = {
  name: 'checkpoints',
  altNames: ['checkpoint'],
  description: 'Compatibility command for nested checkpoint operations',
  kind: CommandKind.BUILT_IN,
  hidden: true,
  autoExecute: false,
  subCommands: checkpointSubCommands,
};

const chatSubCommands: SlashCommand[] = [
  ...checkpointSubCommands.map((subCommand) => ({
    ...subCommand,
    suggestionGroup: CHECKPOINT_MENU_GROUP,
  })),
  checkpointCompatibilityCommand,
  forkCommand,
];

export const chatCommand: SlashCommand = {
  name: 'chat',
  altNames: ['resume', 'session'],
  description: 'Browse auto-saved conversations and manage chat checkpoints',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (
    _context: CommandContext,
    _args: string,
  ): Promise<OpenDialogActionReturn> => ({
    type: 'dialog',
    dialog: 'sessionBrowser',
  }),
  subCommands: chatSubCommands,
};
