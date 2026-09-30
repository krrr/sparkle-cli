/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { performRewind, RewindOutcome } from './rewind.js';
import { coreEvents } from '../utils/events.js';
import type { GeminiClient } from '../core/client.js';
import type { Config } from '../config/config.js';
import type {
  ChatRecordingService,
  ConversationRecord,
} from '../services/chatRecordingService.js';

vi.mock('../utils/events.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/events.js')>();
  return {
    ...actual,
    coreEvents: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
      emitFeedback: vi.fn(),
    },
  };
});

vi.mock('../telemetry/loggers.js', () => ({
  logRewind: vi.fn(),
}));

vi.mock('../utils/rewindUtils.js', () => ({
  revertFileChanges: vi.fn(),
}));

import { logRewind } from '../telemetry/loggers.js';
import { revertFileChanges } from '../utils/rewindUtils.js';

describe('performRewind', () => {
  let mockClient: GeminiClient;
  let mockConfig: Config;
  let mockRecordingService: ChatRecordingService;
  let mockConversation: ConversationRecord;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConversation = {
      sessionId: 'test-session',
      messages: [
        { id: 'msg-1', type: 'user', content: 'hello' },
        { id: 'msg-2', type: 'gemini', content: 'hi' },
      ],
    } as unknown as ConversationRecord;

    mockRecordingService = {
      getConversation: vi.fn().mockReturnValue(mockConversation),
      rewindTo: vi.fn().mockReturnValue(mockConversation),
    } as unknown as ChatRecordingService;

    mockClient = {
      getChatRecordingService: vi.fn().mockReturnValue(mockRecordingService),
      setHistory: vi.fn(),
    } as unknown as GeminiClient;

    mockConfig = {
      getMemoryContextManager: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;
  });

  it('returns a no-op result when the recording service is unavailable', async () => {
    vi.mocked(mockClient.getChatRecordingService).mockReturnValue(undefined);

    const result = await performRewind(
      mockClient,
      mockConfig,
      'msg-1',
      RewindOutcome.RewindOnly,
    );

    expect(result).toEqual({
      conversationRewound: false,
      filesReverted: false,
      conversation: null,
    });
    expect(logRewind).not.toHaveBeenCalled();
  });

  it('returns a no-op result when there is no conversation', async () => {
    vi.mocked(mockRecordingService.getConversation).mockReturnValue(null);

    const result = await performRewind(
      mockClient,
      mockConfig,
      'msg-1',
      RewindOutcome.RewindOnly,
    );

    expect(result).toEqual({
      conversationRewound: false,
      filesReverted: false,
      conversation: null,
    });
    expect(logRewind).not.toHaveBeenCalled();
  });

  it('rewinds the conversation only for RewindOnly', async () => {
    const result = await performRewind(
      mockClient,
      mockConfig,
      'msg-1',
      RewindOutcome.RewindOnly,
    );

    expect(revertFileChanges).not.toHaveBeenCalled();
    expect(mockRecordingService.rewindTo).toHaveBeenCalledWith('msg-1');
    expect(mockClient.setHistory).toHaveBeenCalled();
    expect(result).toEqual({
      conversationRewound: true,
      filesReverted: false,
      conversation: mockConversation,
    });
    expect(logRewind).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ outcome: RewindOutcome.RewindOnly }),
    );
  });

  it('reverts file changes only for RevertOnly', async () => {
    const result = await performRewind(
      mockClient,
      mockConfig,
      'msg-1',
      RewindOutcome.RevertOnly,
    );

    expect(revertFileChanges).toHaveBeenCalledWith(mockConversation, 'msg-1');
    expect(mockRecordingService.rewindTo).not.toHaveBeenCalled();
    expect(mockClient.setHistory).not.toHaveBeenCalled();
    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'info',
      'File changes reverted.',
    );
    expect(result).toEqual({
      conversationRewound: false,
      filesReverted: true,
      conversation: null,
    });
    expect(logRewind).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ outcome: RewindOutcome.RevertOnly }),
    );
  });

  it('reverts file changes then rewinds the conversation for RewindAndRevert', async () => {
    const result = await performRewind(
      mockClient,
      mockConfig,
      'msg-1',
      RewindOutcome.RewindAndRevert,
    );

    expect(revertFileChanges).toHaveBeenCalledWith(mockConversation, 'msg-1');
    expect(mockRecordingService.rewindTo).toHaveBeenCalledWith('msg-1');
    expect(mockClient.setHistory).toHaveBeenCalled();
    expect(result).toEqual({
      conversationRewound: true,
      filesReverted: true,
      conversation: mockConversation,
    });
    expect(logRewind).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ outcome: RewindOutcome.RewindAndRevert }),
    );
  });

  it('refreshes the memory context manager when rewinding', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(mockConfig.getMemoryContextManager).mockReturnValue({
      refresh,
    } as never);

    await performRewind(mockClient, mockConfig, 'msg-1', RewindOutcome.RewindOnly);

    expect(refresh).toHaveBeenCalled();
  });

  it('reports failure when rewindTo returns null', async () => {
    vi.mocked(mockRecordingService.rewindTo).mockReturnValue(null);

    const result = await performRewind(
      mockClient,
      mockConfig,
      'msg-1',
      RewindOutcome.RewindOnly,
    );

    expect(result).toEqual({
      conversationRewound: false,
      filesReverted: false,
      conversation: null,
    });
    expect(coreEvents.emitFeedback).toHaveBeenCalledWith(
      'error',
      'Could not fetch conversation file',
    );
    expect(mockClient.setHistory).not.toHaveBeenCalled();
  });

  it('emits error but still logs telemetry when setHistory throws', async () => {
    vi.mocked(mockClient.setHistory).mockImplementation(() => {
      throw new Error('Rewind Failed');
    });

    const result = await performRewind(
      mockClient,
      mockConfig,
      'msg-1',
      RewindOutcome.RewindOnly,
    );

    expect(result).toEqual({
      conversationRewound: false,
      filesReverted: false,
      conversation: null,
    });
    expect(coreEvents.emitFeedback).toHaveBeenCalledWith('error', 'Rewind Failed');
    // Telemetry records the rewind attempt regardless of success, matching
    // the original CLI behavior.
    expect(logRewind).toHaveBeenCalledWith(
      mockConfig,
      expect.objectContaining({ outcome: RewindOutcome.RewindOnly }),
    );
  });
});
