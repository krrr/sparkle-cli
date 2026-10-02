/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsPromises from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { CommandContext, SlashCommand, OpenDialogActionReturn } from './types.js';
import { CommandKind } from './types.js';
import {
  type MessageActionReturn,
  INITIAL_HISTORY_LENGTH,
  uiTelemetryService,
  type HistoryTurn,
} from 'sparkle-cli-core';
import type { Content } from '@google/genai';
import path from 'node:path';
import type { HistoryItemWithoutId, HistoryItem } from '../types.js';
import { MessageType } from '../types.js';
import { exportHistoryToFile } from '../utils/historyExportUtils.js';
import { convertToRestPayload } from 'sparkle-cli-core';
import { convertSessionToHistoryFormats } from '../hooks/useSessionBrowser.js';
import { cleanMessage } from '../../utils/sessionUtils.js';

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
      await fsPromises.writeFile(filePath, JSON.stringify(restPayload, null, 2));
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
      const originalRecord = geminiClient.getChatRecordingService()?.getConversation();
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
              forkSourceName = cleanMessage(text);
              break;
            }
          }
        }
      }
      const forkSummary = `Fork: ${forkSourceName || 'Untitled'}`.slice(0, 200);

      // Clear any pending user steering hints
      config?.injectionService?.clear();

      // Start a new conversation recording with a new session ID. We must
      // reset the session state BEFORE calling resetChat so the new
      // ChatRecordingService initialized by GeminiChat picks up the new id.
      const newSessionId = randomUUID();
      config?.resetNewSessionState(newSessionId);
      uiTelemetryService.clear(newSessionId);

      // Reset the chat with the copied history. resetChat swaps the client to
      // the new chat/session, so the writes below land in the forked session
      // file rather than the original one.
      await geminiClient.resetChat([...history]);

      // The new recording was rebuilt from the bare model-facing history, so
      // restore the original UI metadata (tool-call result display, display
      // names, descriptions, thoughts, tokens, model) from the source
      // conversation to keep the forked session's details intact.
      geminiClient.getChatRecordingService()?.mergeMetadataFrom(originalRecord);

      // Persist the distinguishing summary. AI summary generation skips
      // sessions that already have a summary, so this is stable.
      geminiClient.getChatRecordingService()?.saveSummary(forkSummary);

      // Rebuild the UI history from the source recording (mirroring what
      // resume/rewind do) so tool groups and their UI metadata are shown in
      // the live transcript, falling back to the model-facing history when
      // no recording is available.
      const rawUiHistory = originalRecord
        ? convertSessionToHistoryFormats(originalRecord.messages).uiHistory
        : convertContentHistoryToUiHistory(history);
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

const chatSubCommands: SlashCommand[] = [shareCommand, forkCommand];

export const chatCommand: SlashCommand = {
  name: 'chat',
  altNames: ['resume', 'session'],
  description: 'Browse auto-saved conversations',
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
