/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import {
  calculateTurnStats,
  calculateRewindImpact,
  revertFileChanges,
} from './rewindUtils.js';
import {
  coreEvents,
  CoreToolCallStatus,
  type ConversationRecord,
  type MessageRecord,
  type ToolCallRecord,
} from '../index.js';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rm: vi.fn(),
    unlink: vi.fn(),
  },
}));

// Mock the diff helpers used to extract FileDiff data
vi.mock('./fileDiffUtils.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fileDiffUtils.js')>();
  return {
    ...actual,
    getFileDiffFromResultDisplay: vi.fn(),
    computeModelAddedAndRemovedLines: vi.fn(),
  };
});

import {
  getFileDiffFromResultDisplay,
  computeModelAddedAndRemovedLines,
} from './fileDiffUtils.js';

describe('rewindUtils', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // `clearAllMocks` keeps implementations, so reset the mocked helper to its
    // real behavior to stop `mockReturnValue` leaking between test cases.
    const actual =
      await vi.importActual<typeof import('./fileDiffUtils.js')>('./fileDiffUtils.js');
    vi.mocked(computeModelAddedAndRemovedLines).mockImplementation(
      actual.computeModelAddedAndRemovedLines,
    );
    vi.spyOn(coreEvents, 'emitFeedback');
  });

  describe('calculateTurnStats', () => {
    it('returns null if no edits found after user message', () => {
      const userMsg = { type: 'user' } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          { type: 'gemini', text: 'Hello' } as unknown as MessageRecord,
        ],
      };
      const result = calculateTurnStats(
        conversation as unknown as ConversationRecord,
        userMsg,
      );
      expect(result).toBeNull();
    });

    it('calculates stats for single turn correctly', () => {
      vi.mocked(getFileDiffFromResultDisplay).mockReturnValue({
        filePath: 'test.ts',
        fileName: 'test.ts',
        originalContent: 'old',
        newContent: 'new',
        isNewFile: false,
        diffStat: {
          model_added_lines: 0,
          model_removed_lines: 0,
          model_added_chars: 0,
          model_removed_chars: 0,
          user_added_lines: 0,
          user_removed_lines: 0,
          user_added_chars: 0,
          user_removed_chars: 0,
        },
        fileDiff: 'diff',
      });
      vi.mocked(computeModelAddedAndRemovedLines).mockReturnValue({
        addedLines: 3,
        removedLines: 3,
      });

      const userMsg = { type: 'user' } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'call-1',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'diff',
              },
            ],
          } as unknown as MessageRecord,
        ],
      };

      const result = calculateTurnStats(
        conversation as unknown as ConversationRecord,
        userMsg,
      );
      expect(result).toEqual({
        fileCount: 1,
        addedLines: 3,
        removedLines: 3,
        details: [{ fileName: 'test.ts', diff: 'diff' }],
      });
    });

    it('returns details so the UI can name the single changed file', () => {
      vi.mocked(getFileDiffFromResultDisplay).mockReturnValue({
        filePath: '/abs/src/a.ts',
        fileName: 'a.ts',
        originalContent: 'old',
        newContent: 'new',
        isNewFile: false,
        diffStat: {
          model_added_lines: 1,
          model_removed_lines: 0,
          model_added_chars: 1,
          model_removed_chars: 0,
          user_added_lines: 0,
          user_removed_lines: 0,
          user_added_chars: 0,
          user_removed_chars: 0,
        },
        fileDiff: 'the-diff',
      });

      const userMsg = { type: 'user' } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'call-1',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'diff',
              },
            ],
          } as unknown as MessageRecord,
        ],
      };

      const result = calculateTurnStats(
        conversation as unknown as ConversationRecord,
        userMsg,
      );
      expect(result?.details).toEqual([{ fileName: 'a.ts', diff: 'the-diff' }]);
    });

    it('ignores edits the user declined, which keep a diff for confirmation', () => {
      // `StateManager.toCancelled` copies the confirmation diff into
      // `resultDisplay`, so a rejected edit looks like a real one unless the
      // status is checked.
      vi.mocked(getFileDiffFromResultDisplay).mockReturnValue({
        filePath: 'test.ts',
        fileName: 'test.ts',
        originalContent: 'old',
        newContent: 'new',
        isNewFile: false,
        diffStat: {
          model_added_lines: 4,
          model_removed_lines: 2,
          model_added_chars: 10,
          model_removed_chars: 5,
          user_added_lines: 0,
          user_removed_lines: 0,
          user_added_chars: 0,
          user_removed_chars: 0,
        },
        fileDiff: 'diff',
      });

      const userMsg = { type: 'user' } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'call-1',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Cancelled,
                resultDisplay: 'diff',
              },
            ],
          } as unknown as MessageRecord,
        ],
      };

      expect(
        calculateTurnStats(conversation as unknown as ConversationRecord, userMsg),
      ).toBeNull();
      expect(
        calculateRewindImpact(conversation as unknown as ConversationRecord, userMsg),
      ).toBeNull();
    });

    it('counts files by path so same-named files stay distinct', () => {
      const fileDiff = (filePath: string) => ({
        filePath,
        fileName: 'index.ts',
        originalContent: 'old',
        newContent: 'new',
        isNewFile: false,
        diffStat: {
          model_added_lines: 2,
          model_removed_lines: 0,
          model_added_chars: 2,
          model_removed_chars: 0,
          user_added_lines: 0,
          user_removed_lines: 0,
          user_added_chars: 0,
          user_removed_chars: 0,
        },
        fileDiff: `diff:${filePath}`,
      });
      vi.mocked(getFileDiffFromResultDisplay)
        .mockReturnValueOnce(fileDiff('/a/index.ts'))
        .mockReturnValueOnce(fileDiff('/b/index.ts'));

      const userMsg = { type: 'user' } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'call-1',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'diff',
              },
              {
                id: 'call-2',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'diff',
              },
            ],
          } as unknown as MessageRecord,
        ],
      };

      const result = calculateTurnStats(
        conversation as unknown as ConversationRecord,
        userMsg,
      );
      expect(result).toEqual({
        fileCount: 2,
        addedLines: 4,
        removedLines: 0,
        details: [
          { fileName: 'index.ts', diff: 'diff:/a/index.ts' },
          { fileName: 'index.ts', diff: 'diff:/b/index.ts' },
        ],
      });
    });

    it('counts edits made after a tool call within the same turn', () => {
      const fileDiff = {
        filePath: 'test.ts',
        fileName: 'test.ts',
        originalContent: 'old',
        newContent: 'new',
        isNewFile: false,
        diffStat: {
          model_added_lines: 0,
          model_removed_lines: 0,
          model_added_chars: 0,
          model_removed_chars: 0,
          user_added_lines: 0,
          user_removed_lines: 0,
          user_added_chars: 0,
          user_removed_chars: 0,
        },
        fileDiff: 'diff',
      };
      vi.mocked(getFileDiffFromResultDisplay)
        // The earlier read_file call produced no file diff.
        .mockReturnValueOnce(undefined)
        .mockReturnValue(fileDiff);
      vi.mocked(computeModelAddedAndRemovedLines).mockReturnValue({
        addedLines: 2,
        removedLines: 1,
      });

      const userMsg = {
        type: 'user',
        content: [{ text: 'Refactor this file' }],
      } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'read-1',
                name: 'read_file',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'file contents',
              },
            ],
          },
          {
            // Tool responses are recorded as `user` messages and must not end
            // the turn.
            type: 'user',
            content: [
              {
                functionResponse: {
                  id: 'read_file__call_00',
                  name: 'read_file',
                  response: { output: 'ok' },
                },
              },
            ],
          },
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'edit-1',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'diff',
              },
            ],
          },
        ],
      } as unknown as ConversationRecord;

      const result = calculateTurnStats(conversation, userMsg);

      expect(result).toEqual({
        fileCount: 1,
        addedLines: 2,
        removedLines: 1,
        details: [{ fileName: 'test.ts', diff: 'diff' }],
      });
    });
  });

  describe('calculateRewindImpact', () => {
    it('calculates cumulative stats across multiple turns', () => {
      vi.mocked(getFileDiffFromResultDisplay)
        .mockReturnValueOnce({
          filePath: 'file1.ts',
          fileName: 'file1.ts',
          originalContent: '123',
          newContent: '12345',
          isNewFile: false,
          diffStat: {
            model_added_lines: 0,
            model_removed_lines: 0,
            model_added_chars: 0,
            model_removed_chars: 0,
            user_added_lines: 0,
            user_removed_lines: 0,
            user_added_chars: 0,
            user_removed_chars: 0,
          },
          fileDiff: 'diff1',
        })
        .mockReturnValueOnce({
          filePath: 'file2.ts',
          fileName: 'file2.ts',
          originalContent: 'abc',
          newContent: 'abcd',
          isNewFile: true,
          diffStat: {
            model_added_lines: 0,
            model_removed_lines: 0,
            model_added_chars: 0,
            model_removed_chars: 0,
            user_added_lines: 0,
            user_removed_lines: 0,
            user_added_chars: 0,
            user_removed_chars: 0,
          },
          fileDiff: 'diff2',
        });

      vi.mocked(computeModelAddedAndRemovedLines)
        .mockReturnValueOnce({ addedLines: 5, removedLines: 3 })
        .mockReturnValueOnce({ addedLines: 4, removedLines: 0 });

      const userMsg = { type: 'user' } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'call-1',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'd1',
              } as unknown as ToolCallRecord,
            ],
          } as unknown as MessageRecord,
          {
            type: 'user',
          } as unknown as MessageRecord,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'call-2',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'd2',
              } as unknown as ToolCallRecord,
            ],
          } as unknown as MessageRecord,
        ],
      };

      const result = calculateRewindImpact(
        conversation as unknown as ConversationRecord,
        userMsg,
      );
      expect(result).toEqual({
        fileCount: 2,
        addedLines: 9, // 5 + 4
        removedLines: 3, // 3 + 0
        details: [
          { fileName: 'file1.ts', diff: 'diff1' },
          { fileName: 'file2.ts', diff: 'diff2' },
        ],
      });
    });

    it('still counts an edit that finished before the turn was cancelled', () => {
      // `Scheduler.cancelAll` skips calls that are already terminal, so an edit
      // whose write landed keeps `Success` even when the user then hits Ctrl+C.
      // Only the not-yet-written calls become `Cancelled`.
      vi.mocked(getFileDiffFromResultDisplay).mockReturnValue({
        filePath: '/abs/a.ts',
        fileName: 'a.ts',
        originalContent: 'old',
        newContent: 'new',
        isNewFile: false,
        diffStat: {
          model_added_lines: 2,
          model_removed_lines: 1,
          model_added_chars: 2,
          model_removed_chars: 1,
          user_added_lines: 0,
          user_removed_lines: 0,
          user_added_chars: 0,
          user_removed_chars: 0,
        },
        fileDiff: 'the-diff',
      });

      const userMsg = { type: 'user' } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'landed',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'diff',
              },
              {
                id: 'interrupted',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Cancelled,
                resultDisplay: undefined,
              },
            ],
          } as unknown as MessageRecord,
        ],
      };

      const result = calculateTurnStats(
        conversation as unknown as ConversationRecord,
        userMsg,
      );
      expect(result).toEqual({
        fileCount: 1,
        addedLines: 2,
        removedLines: 1,
        details: [{ fileName: 'a.ts', diff: 'the-diff' }],
      });
    });

    it('skips edits that were declined and never landed', () => {
      vi.mocked(getFileDiffFromResultDisplay).mockReturnValue({
        filePath: 'file1.ts',
        fileName: 'file1.ts',
        originalContent: '123',
        newContent: '12345',
        isNewFile: false,
        diffStat: {
          model_added_lines: 5,
          model_removed_lines: 3,
          model_added_chars: 0,
          model_removed_chars: 0,
          user_added_lines: 0,
          user_removed_lines: 0,
          user_added_chars: 0,
          user_removed_chars: 0,
        },
        fileDiff: 'diff1',
      });

      const userMsg = { type: 'user' } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'call-1',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Cancelled,
                resultDisplay: 'd1',
              } as unknown as ToolCallRecord,
            ],
          } as unknown as MessageRecord,
        ],
      };

      expect(
        calculateRewindImpact(conversation as unknown as ConversationRecord, userMsg),
      ).toBeNull();
    });
  });

  describe('revertFileChanges', () => {
    it('does nothing if message not found', async () => {
      await revertFileChanges(
        { messages: [] } as unknown as ConversationRecord,
        'missing',
      );
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('leaves files alone when the only edit was declined by the user', async () => {
      // A rejected edit still carries the confirmation diff, and the user may
      // have typed the same change by hand. Reverting it would destroy that.
      vi.mocked(getFileDiffFromResultDisplay).mockReturnValue({
        filePath: '/abs/path/test.ts',
        fileName: 'test.ts',
        originalContent: 'ORIGINAL_CONTENT',
        newContent: 'NEW_CONTENT',
        isNewFile: false,
        diffStat: {
          model_added_lines: 1,
          model_removed_lines: 1,
          model_added_chars: 1,
          model_removed_chars: 1,
          user_added_lines: 0,
          user_removed_lines: 0,
          user_added_chars: 0,
          user_removed_chars: 0,
        },
        fileDiff: 'diff',
      });

      const userMsg = {
        type: 'user',
        id: 'target',
      } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'call-1',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Cancelled,
                resultDisplay: 'diff',
              } as unknown as ToolCallRecord,
            ],
          } as unknown as MessageRecord,
        ],
      };

      // The user typed NEW_CONTENT themselves; a revert would wipe it.
      vi.mocked(fs.readFile).mockResolvedValue('NEW_CONTENT');

      await revertFileChanges(conversation as unknown as ConversationRecord, 'target');

      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.unlink).not.toHaveBeenCalled();
      expect(coreEvents.emitFeedback).not.toHaveBeenCalled();
    });

    it('reverts exact match', async () => {
      vi.mocked(getFileDiffFromResultDisplay).mockReturnValue({
        filePath: '/abs/path/test.ts',
        fileName: 'test.ts',
        originalContent: 'ORIGINAL_CONTENT',
        newContent: 'NEW_CONTENT',
        isNewFile: false,
        diffStat: {
          model_added_lines: 0,
          model_removed_lines: 0,
          model_added_chars: 0,
          model_removed_chars: 0,
          user_added_lines: 0,
          user_removed_lines: 0,
          user_added_chars: 0,
          user_removed_chars: 0,
        },
        fileDiff: 'diff',
      });

      const userMsg = {
        type: 'user',
        id: 'target',
      } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'call-1',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'diff',
              } as unknown as ToolCallRecord,
            ],
          } as unknown as MessageRecord,
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValue('NEW_CONTENT');

      await revertFileChanges(conversation as unknown as ConversationRecord, 'target');

      expect(fs.writeFile).toHaveBeenCalledWith(
        '/abs/path/test.ts',
        'ORIGINAL_CONTENT',
      );
    });

    it('deletes new file on revert', async () => {
      vi.mocked(getFileDiffFromResultDisplay).mockReturnValue({
        filePath: '/abs/path/new.ts',
        fileName: 'new.ts',
        originalContent: '',
        newContent: 'SOME_CONTENT',
        isNewFile: true,
        diffStat: {
          model_added_lines: 0,
          model_removed_lines: 0,
          model_added_chars: 0,
          model_removed_chars: 0,
          user_added_lines: 0,
          user_removed_lines: 0,
          user_added_chars: 0,
          user_removed_chars: 0,
        },
        fileDiff: 'diff',
      });

      const userMsg = {
        type: 'user',
        id: 'target',
      } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'call-1',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'diff',
              } as unknown as ToolCallRecord,
            ],
          } as unknown as MessageRecord,
        ],
      };

      vi.mocked(fs.readFile).mockResolvedValue('SOME_CONTENT');

      await revertFileChanges(conversation as unknown as ConversationRecord, 'target');

      expect(fs.unlink).toHaveBeenCalledWith('/abs/path/new.ts');
    });

    it('handles smart revert (patching) successfully', async () => {
      vi.mocked(getFileDiffFromResultDisplay).mockReturnValue({
        filePath: '/abs/path/test.ts',
        fileName: 'test.ts',
        originalContent: 'LINE1\nLINE2\nLINE3',
        newContent: 'LINE1\nEDITED\nLINE3',
        isNewFile: false,
        diffStat: {
          model_added_lines: 0,
          model_removed_lines: 0,
          model_added_chars: 0,
          model_removed_chars: 0,
          user_added_lines: 0,
          user_removed_lines: 0,
          user_added_chars: 0,
          user_removed_chars: 0,
        },
        fileDiff: 'diff',
      });

      const userMsg = {
        type: 'user',
        id: 'target',
      } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'call-1',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'diff',
              } as unknown as ToolCallRecord,
            ],
          } as unknown as MessageRecord,
        ],
      };

      // Current content has FURTHER changes
      vi.mocked(fs.readFile).mockResolvedValue('LINE1\nEDITED\nLINE3\nNEWLINE');

      await revertFileChanges(conversation as unknown as ConversationRecord, 'target');

      // Should have successfully patched it back to ORIGINAL state but kept the NEWLINE
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/abs/path/test.ts',
        'LINE1\nLINE2\nLINE3\nNEWLINE',
      );
    });

    it('emits warning on smart revert failure', async () => {
      vi.mocked(getFileDiffFromResultDisplay).mockReturnValue({
        filePath: '/abs/path/test.ts',
        fileName: 'test.ts',
        originalContent: 'OLD',
        newContent: 'NEW',
        isNewFile: false,
        diffStat: {
          model_added_lines: 0,
          model_removed_lines: 0,
          model_added_chars: 0,
          model_removed_chars: 0,
          user_added_lines: 0,
          user_removed_lines: 0,
          user_added_chars: 0,
          user_removed_chars: 0,
        },
        fileDiff: 'diff',
      });

      const userMsg = {
        type: 'user',
        id: 'target',
      } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'call-1',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'diff',
              } as unknown as ToolCallRecord,
            ],
          } as unknown as MessageRecord,
        ],
      };

      // Current content is completely unrelated - diff won't apply
      vi.mocked(fs.readFile).mockResolvedValue('UNRELATED');

      await revertFileChanges(conversation as unknown as ConversationRecord, 'target');

      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
        'warning',
        expect.stringContaining('Smart revert for test.ts failed'),
      );
    });

    it('emits error if fs.readFile fails with a generic error', async () => {
      vi.mocked(getFileDiffFromResultDisplay).mockReturnValue({
        filePath: '/abs/path/test.ts',
        fileName: 'test.ts',
        originalContent: 'OLD',
        newContent: 'NEW',
        isNewFile: false,
        diffStat: {
          model_added_lines: 0,
          model_removed_lines: 0,
          model_added_chars: 0,
          model_removed_chars: 0,
          user_added_lines: 0,
          user_removed_lines: 0,
          user_added_chars: 0,
          user_removed_chars: 0,
        },
        fileDiff: 'diff',
      });

      const userMsg = {
        type: 'user',
        id: 'target',
      } as unknown as MessageRecord;
      const conversation = {
        messages: [
          userMsg,
          {
            type: 'gemini',
            toolCalls: [
              {
                id: 'call-1',
                name: 'replace',
                args: {},
                status: CoreToolCallStatus.Success,
                resultDisplay: 'diff',
              } as unknown as ToolCallRecord,
            ],
          } as unknown as MessageRecord,
        ],
      };

      vi.mocked(fs.readFile).mockRejectedValue(new Error('disk failure'));

      await revertFileChanges(conversation as unknown as ConversationRecord, 'target');

      expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('Error reading test.ts during revert: disk failure'),
        expect.any(Error),
      );
    });
  });
});
