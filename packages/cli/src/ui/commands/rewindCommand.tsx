/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandKind, type CommandContext, type SlashCommand } from './types.js';
import { RewindViewer } from '../components/RewindViewer.js';
import { type HistoryItem } from '../types.js';
import { convertSessionToHistoryFormats } from '../hooks/useSessionBrowser.js';
import {
  coreEvents,
  performRewind,
  type ConversationRecord,
  RewindOutcome,
} from 'sparkle-cli-core';

/**
 * Helper function to handle the UI part of rewinding a conversation.
 * The conversation truncation and history conversion is performed by
 * `performRewind` in core; this only renders the rewound history in the CLI.
 *
 * @param context The command context.
 * @param rewoundConversation The truncated conversation returned by `performRewind`.
 * @param newText The new text for the input field after rewinding.
 */
function loadRewoundHistory(
  context: CommandContext,
  rewoundConversation: ConversationRecord,
  newText: string,
) {
  // Convert to UI format
  const { uiHistory } = convertSessionToHistoryFormats(rewoundConversation.messages);

  // Update UI History
  // We generate IDs based on index for the rewind history
  const startId = 1;
  const historyWithIds = uiHistory.map(
    (item, idx) =>
      ({
        ...item,
        id: startId + idx,
      }) as HistoryItem,
  );

  // 1. Remove component FIRST to avoid flicker and clear the stage
  context.ui.removeComponent();

  // 2. Load the rewound history and set the input
  context.ui.loadHistory(historyWithIds, newText);
}

export const rewindCommand: SlashCommand = {
  name: 'rewind',
  description: 'Jump back to a specific message and restart the conversation',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: (context) => {
    const agentContext = context.services.agentContext;
    const config = agentContext?.config;
    if (!config)
      return {
        type: 'message',
        messageType: 'error',
        content: 'Config not found',
      };

    const client = agentContext.geminiClient;
    if (!client)
      return {
        type: 'message',
        messageType: 'error',
        content: 'Client not initialized',
      };

    const recordingService = client.getChatRecordingService();
    if (!recordingService)
      return {
        type: 'message',
        messageType: 'error',
        content: 'Recording service unavailable',
      };

    const conversation = recordingService.getConversation();
    if (!conversation)
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation found.',
      };

    const hasUserInteractions = conversation.messages.some((m) => m.type === 'user');
    if (!hasUserInteractions) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'Nothing to rewind to.',
      };
    }

    return {
      type: 'custom_dialog',
      component: (
        <RewindViewer
          conversation={conversation}
          onExit={() => {
            context.ui.removeComponent();
          }}
          onRewind={async (messageId, newText, outcome) => {
            if (outcome === RewindOutcome.Cancel) {
              context.ui.removeComponent();
              return;
            }

            try {
              const result = await performRewind(client, config, messageId, outcome);

              if (result.conversationRewound && result.conversation) {
                loadRewoundHistory(context, result.conversation, newText);
              } else {
                // RevertOnly (or a failed rewind): just clear the stage.
                context.ui.removeComponent();
              }
            } catch (error) {
              // If an error occurs, we still want to remove the component if possible
              context.ui.removeComponent();
              coreEvents.emitFeedback(
                'error',
                error instanceof Error ? error.message : 'Unknown error during rewind',
              );
            }
          }}
        />
      ),
    };
  },
};
