/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import * as Diff from 'diff';
import { coreEvents } from './events.js';
import { debugLogger } from './debugLogger.js';
import {
  getFileDiffFromResultDisplay,
  computeModelAddedAndRemovedLines,
} from './fileDiffUtils.js';
import { isUserPromptMessage } from './sessionUtils.js';
import { CoreToolCallStatus } from '../scheduler/types.js';
import type {
  ConversationRecord,
  MessageRecord,
  ToolCallRecord,
} from '../services/chatRecordingService.js';

export interface FileChangeDetail {
  fileName: string;
  diff: string;
}

export interface FileChangeStats {
  addedLines: number;
  removedLines: number;
  fileCount: number;
  details?: FileChangeDetail[];
}

/**
 * Returns true only for tool calls that actually reached the file system.
 *
 * `Success` is the exact marker for "the write landed". It also survives a
 * cancellation: `Scheduler.cancelAll` skips calls that are already terminal, so
 * an edit that finished writing before Ctrl+C stays `Success` and is still
 * counted and reverted.
 *
 * The one non-successful state that carries a diff is a declined edit:
 * `StateManager.toCancelled` copies the confirmation details into
 * `resultDisplay`. That diff describes a write the user refused, so counting it
 * would report changes that never happened — and reverting it would undo
 * whatever the user typed by hand instead.
 *
 * An edit interrupted mid-execution is `Cancelled` with no diff at all, because
 * `cancelAll` finalizes the call first and the executor's later status update is
 * then dropped (`updateStatus` ignores calls that are no longer active).
 */
function isLandedFileEdit(toolCall: ToolCallRecord): boolean {
  return toolCall.status === CoreToolCallStatus.Success;
}

/**
 * Collects the file edits recorded in a range of messages.
 *
 * @param messages The full conversation message list.
 * @param startIndex Index of the first message to inspect.
 * @param stopAtUserPrompt Whether to stop at the next real user prompt (a single
 *   turn) or keep scanning to the end of the conversation.
 * @returns Aggregated statistics, or null when no edit landed on disk.
 */
function collectFileEdits(
  messages: readonly MessageRecord[],
  startIndex: number,
  stopAtUserPrompt: boolean,
): FileChangeStats | null {
  let addedLines = 0;
  let removedLines = 0;
  // Keyed by absolute path: two files sharing a basename are distinct edits.
  const files = new Map<string, FileChangeDetail>();

  for (let i = startIndex; i < messages.length; i++) {
    const msg = messages[i];
    // Tool responses are recorded as `user` messages carrying only a
    // functionResponse part, so `isUserPromptMessage` is what ends a turn.
    if (stopAtUserPrompt && isUserPromptMessage(msg)) break;

    if (msg.type !== 'gemini' || !msg.toolCalls) continue;

    for (const toolCall of msg.toolCalls) {
      if (!isLandedFileEdit(toolCall)) continue;

      const fileDiff = getFileDiffFromResultDisplay(toolCall.resultDisplay);
      if (!fileDiff) continue;

      const calculations = computeModelAddedAndRemovedLines(fileDiff.diffStat);
      addedLines += calculations.addedLines;
      removedLines += calculations.removedLines;

      if (!files.has(fileDiff.filePath)) {
        files.set(fileDiff.filePath, {
          fileName: fileDiff.fileName,
          diff: fileDiff.fileDiff,
        });
      }
    }
  }

  if (files.size === 0) return null;

  return {
    addedLines,
    removedLines,
    fileCount: files.size,
    details: [...files.values()],
  };
}

/**
 * Calculates file change statistics for a single turn.
 * A turn is defined as the sequence of messages starting after the given user message
 * and continuing until the next user message or the end of the conversation.
 *
 * @param conversation The full conversation record.
 * @param userMessage The starting user message for the turn.
 * @returns Statistics about lines added/removed and files touched, or null if no edits occurred.
 */
export function calculateTurnStats(
  conversation: ConversationRecord,
  userMessage: MessageRecord,
): FileChangeStats | null {
  const msgIndex = conversation.messages.indexOf(userMessage);
  if (msgIndex === -1) return null;

  // Look ahead until the next real user prompt (single turn).
  return collectFileEdits(conversation.messages, msgIndex + 1, true);
}

/**
 * Calculates the cumulative file change statistics from a specific message
 * to the end of the conversation.
 *
 * @param conversation The full conversation record.
 * @param userMessage The message to start calculating impact from (exclusive).
 * @returns Aggregate statistics about lines added/removed and files touched, or null if no edits occurred.
 */
export function calculateRewindImpact(
  conversation: ConversationRecord,
  userMessage: MessageRecord,
): FileChangeStats | null {
  const msgIndex = conversation.messages.indexOf(userMessage);
  if (msgIndex === -1) return null;

  // Scan to the end of the conversation: the whole remaining history is undone.
  return collectFileEdits(conversation.messages, msgIndex + 1, false);
}

/**
 * Reverts file changes made by the model from the end of the conversation
 * back to a specific target message.
 *
 * It iterates backwards through the conversation history and attempts to undo
 * any file modifications. It handles cases where the user might have subsequently
 * modified the file by attempting a smart patch (using the `diff` library).
 *
 * @param conversation The full conversation record.
 * @param targetMessageId The ID of the message to revert back to. Changes *after* this message will be undone.
 */
export async function revertFileChanges(
  conversation: ConversationRecord,
  targetMessageId: string,
): Promise<void> {
  const messageIndex = conversation.messages.findIndex((m) => m.id === targetMessageId);

  if (messageIndex === -1) {
    debugLogger.error('Requested message to rewind to was not found ');
    return;
  }

  // Iterate backwards from the end to the message being rewound (exclusive of the messageId itself)
  for (let i = conversation.messages.length - 1; i > messageIndex; i--) {
    const msg = conversation.messages[i];
    if (msg.type === 'gemini' && msg.toolCalls) {
      for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
        const toolCall = msg.toolCalls[j];
        // Declined edits never touched the disk; reverting them would clobber
        // whatever the user wrote in the meantime.
        if (!isLandedFileEdit(toolCall)) continue;

        const fileDiff = getFileDiffFromResultDisplay(toolCall.resultDisplay);
        if (fileDiff) {
          const { filePath, fileName, newContent, originalContent, isNewFile } =
            fileDiff;
          try {
            let currentContent: string | null = null;
            try {
              currentContent = await fs.readFile(filePath, 'utf8');
            } catch (e) {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
              const error = e as Error;
              if ('code' in error && error.code === 'ENOENT') {
                // File does not exist, which is fine in some revert scenarios.
                debugLogger.debug(
                  `File ${fileName} not found during revert, proceeding as it may be a new file deletion.`,
                );
              } else {
                // Other read errors are unexpected.
                coreEvents.emitFeedback(
                  'error',
                  `Error reading ${fileName} during revert: ${error.message}`,
                  e,
                );
                continue; // Continue to next tool call
              }
            }
            // 1. Exact Match: Safe to revert directly
            if (currentContent === newContent) {
              if (!isNewFile) {
                await fs.writeFile(filePath, originalContent ?? '');
              } else {
                // Original content was null (new file), so we delete the file
                await fs.unlink(filePath);
              }
            }
            // 2. Mismatch: Attempt Smart Revert (Patch)
            else if (currentContent !== null) {
              const originalText = originalContent ?? '';

              // Create a patch that transforms Agent -> Original
              const undoPatch = Diff.createPatch(fileName, newContent, originalText);

              // Apply that patch to the Current content
              const patchedContent = Diff.applyPatch(currentContent, undoPatch);

              if (typeof patchedContent === 'string') {
                if (patchedContent === '' && isNewFile) {
                  // If the result is empty and the file didn't exist originally, delete it
                  await fs.unlink(filePath);
                } else {
                  await fs.writeFile(filePath, patchedContent);
                }
              } else {
                // Patch failed
                coreEvents.emitFeedback(
                  'warning',
                  `Smart revert for ${fileName} failed. The file may have been modified in a way that conflicts with the undo operation.`,
                );
              }
            } else {
              // File was deleted by the user, but we expected content.
              // This can happen if a file created by the agent is deleted before rewind.
              coreEvents.emitFeedback(
                'warning',
                `Cannot revert changes for ${fileName} because it was not found on disk. This is expected if a file created by the agent was deleted before rewind`,
              );
            }
          } catch (e) {
            coreEvents.emitFeedback(
              'error',
              `An unexpected error occurred while reverting ${fileName}.`,
              e,
            );
          }
        }
      }
    }
  }
}
