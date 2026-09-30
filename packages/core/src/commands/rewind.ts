/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import type { GeminiClient } from '../core/client.js';
import {
  type ChatRecordingService,
  type ConversationRecord,
} from '../services/chatRecordingService.js';
import { convertSessionToClientHistory } from '../utils/sessionUtils.js';
import { checkExhaustive } from '../utils/checks.js';
import { coreEvents } from '../utils/events.js';
import { debugLogger } from '../utils/debugLogger.js';
import { logRewind } from '../telemetry/loggers.js';
import { RewindEvent } from '../telemetry/types.js';
import { revertFileChanges } from '../utils/rewindUtils.js';

/**
 * The action to take when rewinding. Shared across all surfaces (interactive
 * CLI, ACP, a2a) so they can present a consistent rewind UX.
 */
export enum RewindOutcome {
  RewindAndRevert = 'rewind_and_revert',
  RewindOnly = 'rewind_only',
  RevertOnly = 'revert_only',
  Cancel = 'cancel',
}

/** Structured result of a rewind operation, allowing hosts to surface
 * per-step outcomes (e.g. in non-interactive clients where nobody is
 * watching a UI for feedback events). */
export interface RewindResult {
  /** Whether the conversation history was rewound. */
  conversationRewound: boolean;
  /** Whether file changes were reverted (or an attempt was made). */
  filesReverted: boolean;
  /**
   * The truncated conversation when `conversationRewound` is true; null
   * otherwise. Hosts use this to render the rewound history.
   */
  conversation: ConversationRecord | null;
}

async function rewindConversation(
  client: GeminiClient,
  recordingService: ChatRecordingService,
  config: Config,
  messageId: string,
): Promise<ConversationRecord | null> {
  try {
    const conversation = recordingService.rewindTo(messageId);
    if (!conversation) {
      const errorMsg = 'Could not fetch conversation file';
      debugLogger.error(errorMsg);
      coreEvents.emitFeedback('error', errorMsg);
      return null;
    }

    const clientHistory = convertSessionToClientHistory(conversation.messages);
    client.setHistory(clientHistory);

    // Reset context manager as we are rewinding history
    await config.getMemoryContextManager()?.refresh();

    return conversation;
  } catch (error) {
    coreEvents.emitFeedback(
      'error',
      error instanceof Error ? error.message : 'Unknown error during rewind',
    );
    return null;
  }
}

/**
 * Performs a rewind to the given message, coordinating conversation truncation
 * and (optionally) file reversion. UI-agnostic; hosts render their own views
 * and translate user intent into a {@link RewindOutcome}.
 *
 * @param client The Gemini client whose history is rewound.
 * @param config The active config, used for telemetry and context refresh.
 * @param messageId The ID of the user message to rewind to.
 * @param outcome Which parts of the state to rewind.
 */
export async function performRewind(
  client: GeminiClient,
  config: Config,
  messageId: string,
  outcome: Exclude<RewindOutcome, RewindOutcome.Cancel>,
): Promise<RewindResult> {
  const recordingService = client.getChatRecordingService();
  const conversation = recordingService?.getConversation();
  if (!recordingService || !conversation) {
    return {
      conversationRewound: false,
      filesReverted: false,
      conversation: null,
    };
  }

  let result: RewindResult = {
    conversationRewound: false,
    filesReverted: false,
    conversation: null,
  };

  switch (outcome) {
    case RewindOutcome.RevertOnly: {
      await revertFileChanges(conversation, messageId);
      coreEvents.emitFeedback('info', 'File changes reverted.');
      result = {
        conversationRewound: false,
        filesReverted: true,
        conversation: null,
      };
      break;
    }

    case RewindOutcome.RewindAndRevert: {
      await revertFileChanges(conversation, messageId);
      const rewound = await rewindConversation(
        client,
        recordingService,
        config,
        messageId,
      );
      result = {
        conversationRewound: rewound !== null,
        filesReverted: true,
        conversation: rewound,
      };
      break;
    }

    case RewindOutcome.RewindOnly: {
      const rewound = await rewindConversation(
        client,
        recordingService,
        config,
        messageId,
      );
      result = {
        conversationRewound: rewound !== null,
        filesReverted: false,
        conversation: rewound,
      };
      break;
    }

    default:
      checkExhaustive(outcome);
  }

  logRewind(config, new RewindEvent(outcome));

  return result;
}
