/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  uiTelemetryService,
  SessionEndReason,
  SessionStartSource,
  flushTelemetry,
  resetBrowserSession,
} from 'sparkle-cli-core';
import { CommandKind, type SlashCommand } from './types.js';
import { MessageType } from '../types.js';
import { randomUUID } from 'node:crypto';

export const clearCommand: SlashCommand = {
  name: 'clear',
  altNames: ['new'],
  description: 'Clear the screen and start a new session',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, args) => {
    const geminiClient = context.services.agentContext?.geminiClient;
    const config = context.services.agentContext?.config;
    const deleteOldSession = args
      .trim()
      .split(/\s+/)
      .some((arg) => arg === '-d' || arg === '--delete');

    // Fire SessionEnd hook before clearing
    const hookSystem = config?.getHookSystem();
    if (hookSystem) {
      await hookSystem.fireSessionEndEvent(SessionEndReason.Clear);
    }

    // Reset user steering hints
    config?.injectionService.clear();

    // Delete the old session's on-disk record when invoked with -d/--delete.
    // Must run before resetNewSessionState() swaps in the new session id,
    // since deleteCurrentSessionAsync targets the current session.
    let sessionRecordDeleted = false;
    let sessionDeleteFailed = false;
    if (deleteOldSession && geminiClient) {
      const chatRecordingService = geminiClient.getChatRecordingService();
      if (chatRecordingService) {
        try {
          await chatRecordingService.deleteCurrentSessionAsync();
          sessionRecordDeleted = true;
        } catch {
          // A failed deletion must not block starting the new session.
          sessionDeleteFailed = true;
        }
      }
    }

    // Start a new conversation recording with a new session ID
    // We MUST do this before calling resetChat() so the new ChatRecordingService
    // initialized by GeminiChat picks up the new session ID.
    let newSessionId: string | undefined;
    if (config) {
      newSessionId = randomUUID();
      config.resetNewSessionState(newSessionId);
    }

    if (geminiClient) {
      context.ui.setDebugMessage('Clearing terminal and resetting chat.');

      // Close persistent browser sessions before resetting chat
      await resetBrowserSession();

      // If resetChat fails, the exception will propagate and halt the command,
      // which is the correct behavior to signal a failure to the user.
      await geminiClient.resetChat();
    } else {
      context.ui.setDebugMessage('Clearing terminal.');
    }

    // Fire SessionStart hook after clearing
    let result;
    if (hookSystem) {
      result = await hookSystem.fireSessionStartEvent(SessionStartSource.Clear);
    }

    // Give the event loop a chance to process any pending telemetry operations
    // This ensures logger.emit() calls have fully propagated to the BatchLogRecordProcessor
    await new Promise((resolve) => setImmediate(resolve));

    // Flush telemetry to ensure hooks are written to disk immediately
    // This is critical for tests and environments with I/O latency
    if (config) {
      await flushTelemetry(config);
    }

    uiTelemetryService.clear(newSessionId);
    context.ui.clear();

    if (result?.systemMessage) {
      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: result.systemMessage,
        },
        Date.now(),
      );
    }

    if (sessionRecordDeleted || sessionDeleteFailed) {
      context.ui.addItem(
        {
          type: sessionDeleteFailed ? MessageType.ERROR : MessageType.INFO,
          text: sessionDeleteFailed
            ? 'Failed to delete the previous session record.'
            : 'Previous session record deleted.',
        },
        Date.now(),
      );
    }
  },
};
