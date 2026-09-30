/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { rewindCommand } from './rewindCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { waitFor } from '../../test-utils/async.js';
import { RewindOutcome, performRewind, type RewindResult } from 'sparkle-cli-core';
import { type OpenCustomDialogActionReturn, type CommandContext } from './types.js';
import type { ReactElement } from 'react';
import { coreEvents } from 'sparkle-cli-core';

// Mock dependencies
const mockGetConversation = vi.fn();
const mockRemoveComponent = vi.fn();
const mockLoadHistory = vi.fn();
const mockSetInput = vi.fn();

vi.mock('sparkle-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sparkle-cli-core')>();
  return {
    ...actual,
    coreEvents: {
      // eslint-disable-next-line @typescript-eslint/no-misused-spread
      ...actual.coreEvents,
      emitFeedback: vi.fn(),
    },
    performRewind: vi.fn(),
  };
});

vi.mock('../components/RewindViewer.js', () => ({
  RewindViewer: () => null,
}));

vi.mock('../hooks/useSessionBrowser.js', () => ({
  convertSessionToHistoryFormats: vi.fn().mockReturnValue({
    uiHistory: [
      { type: 'user', text: 'old user' },
      { type: 'gemini', text: 'old sparkle' },
    ],
  }),
}));

interface RewindViewerProps {
  onRewind: (
    messageId: string,
    newText: string,
    outcome: RewindOutcome,
  ) => Promise<void>;
  conversation: unknown;
  onExit: () => void;
}

describe('rewindCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetConversation.mockReturnValue({
      messages: [{ id: 'msg-1', type: 'user', content: 'hello' }],
      sessionId: 'test-session',
    });

    vi.mocked(performRewind).mockResolvedValue({
      conversationRewound: true,
      filesReverted: false,
      conversation: {
        sessionId: 'test-session',
        messages: [],
      },
    } as unknown as RewindResult);

    mockContext = createMockCommandContext({
      services: {
        agentContext: {
          geminiClient: {
            getChatRecordingService: () => ({
              getConversation: mockGetConversation,
            }),
          },
          config: {
            getSessionId: () => 'test-session-id',
          },
        },
      },
      ui: {
        removeComponent: mockRemoveComponent,
        loadHistory: mockLoadHistory,
        addItem: vi.fn(),
        setPendingItem: vi.fn(),
      },
    }) as unknown as CommandContext;
  });

  it('should initialize successfully', async () => {
    const result = await rewindCommand.action!(mockContext, '');
    expect(result).toHaveProperty('type', 'custom_dialog');
  });

  it('should delegate to performRewind for RewindOnly and load history', async () => {
    const result = (await rewindCommand.action!(
      mockContext,
      '',
    )) as OpenCustomDialogActionReturn;
    const component = result.component as ReactElement<RewindViewerProps>;
    const onRewind = component.props.onRewind;
    expect(onRewind).toBeDefined();

    await onRewind('msg-id-123', 'New Prompt', RewindOutcome.RewindOnly);

    await waitFor(() => {
      expect(performRewind).toHaveBeenCalledWith(
        mockContext.services.agentContext?.geminiClient,
        mockContext.services.agentContext?.config,
        'msg-id-123',
        RewindOutcome.RewindOnly,
      );
      expect(mockLoadHistory).toHaveBeenCalledWith(
        [
          expect.objectContaining({ text: 'old user', id: 1 }),
          expect.objectContaining({ text: 'old sparkle', id: 2 }),
        ],
        'New Prompt',
      );
      expect(mockRemoveComponent).toHaveBeenCalled();
    });

    // Verify setInput was NOT called directly (it's handled via loadHistory now)
    expect(mockSetInput).not.toHaveBeenCalled();
  });

  it('should delegate to performRewind for RewindAndRevert and load history', async () => {
    vi.mocked(performRewind).mockResolvedValue({
      conversationRewound: true,
      filesReverted: true,
      conversation: {
        sessionId: 'test-session',
        messages: [],
      },
    } as unknown as RewindResult);

    const result = (await rewindCommand.action!(
      mockContext,
      '',
    )) as OpenCustomDialogActionReturn;
    const component = result.component as ReactElement<RewindViewerProps>;
    const onRewind = component.props.onRewind;

    await onRewind('msg-id-123', 'New Prompt', RewindOutcome.RewindAndRevert);

    await waitFor(() => {
      expect(performRewind).toHaveBeenCalledWith(
        mockContext.services.agentContext?.geminiClient,
        mockContext.services.agentContext?.config,
        'msg-id-123',
        RewindOutcome.RewindAndRevert,
      );
      expect(mockLoadHistory).toHaveBeenCalledWith(expect.any(Array), 'New Prompt');
    });
    expect(mockSetInput).not.toHaveBeenCalled();
  });

  it('should not load history for RevertOnly', async () => {
    vi.mocked(performRewind).mockResolvedValue({
      conversationRewound: false,
      filesReverted: true,
      conversation: null,
    } as RewindResult);

    const result = (await rewindCommand.action!(
      mockContext,
      '',
    )) as OpenCustomDialogActionReturn;
    const component = result.component as ReactElement<RewindViewerProps>;
    const onRewind = component.props.onRewind;

    await onRewind('msg-id-123', 'New Prompt', RewindOutcome.RevertOnly);

    await waitFor(() => {
      expect(performRewind).toHaveBeenCalledWith(
        mockContext.services.agentContext?.geminiClient,
        mockContext.services.agentContext?.config,
        'msg-id-123',
        RewindOutcome.RevertOnly,
      );
      expect(mockLoadHistory).not.toHaveBeenCalled();
      expect(mockRemoveComponent).toHaveBeenCalled();
    });
    expect(mockSetInput).not.toHaveBeenCalled();
  });

  it('should not load history when the rewind failed', async () => {
    vi.mocked(performRewind).mockResolvedValue({
      conversationRewound: false,
      filesReverted: false,
      conversation: null,
    } as RewindResult);

    const result = (await rewindCommand.action!(
      mockContext,
      '',
    )) as OpenCustomDialogActionReturn;
    const component = result.component as ReactElement<RewindViewerProps>;
    const onRewind = component.props.onRewind;

    await onRewind('msg-id-123', 'New Prompt', RewindOutcome.RewindOnly);

    await waitFor(() => {
      expect(mockLoadHistory).not.toHaveBeenCalled();
      expect(mockRemoveComponent).toHaveBeenCalled();
    });
  });

  it('should handle Cancel correctly', async () => {
    const result = (await rewindCommand.action!(
      mockContext,
      '',
    )) as OpenCustomDialogActionReturn;
    const component = result.component as ReactElement<RewindViewerProps>;
    const onRewind = component.props.onRewind;

    await onRewind('msg-id-123', 'New Prompt', RewindOutcome.Cancel);

    await waitFor(() => {
      expect(performRewind).not.toHaveBeenCalled();
      expect(mockRemoveComponent).toHaveBeenCalled();
    });
    expect(mockSetInput).not.toHaveBeenCalled();
  });

  it('should handle onExit correctly', async () => {
    const result = (await rewindCommand.action!(
      mockContext,
      '',
    )) as OpenCustomDialogActionReturn;
    const component = result.component as ReactElement<RewindViewerProps>;
    const onExit = component.props.onExit;

    onExit();

    expect(mockRemoveComponent).toHaveBeenCalled();
  });

  it('should surface performRewind errors as feedback', async () => {
    vi.mocked(performRewind).mockRejectedValue(new Error('Rewind Failed'));

    const result = (await rewindCommand.action!(
      mockContext,
      '',
    )) as OpenCustomDialogActionReturn;
    const component = result.component as ReactElement<RewindViewerProps>;
    const onRewind = component.props.onRewind;

    await onRewind('msg-1', 'Prompt', RewindOutcome.RewindOnly);

    await waitFor(() => {
      expect(coreEvents.emitFeedback).toHaveBeenCalledWith('error', 'Rewind Failed');
      expect(mockRemoveComponent).toHaveBeenCalled();
    });
  });

  it('should fail if config is missing', () => {
    const context = { services: {} } as CommandContext;

    const result = rewindCommand.action!(context, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Config not found',
    });
  });

  it('should fail if client is not initialized', () => {
    const context = createMockCommandContext({
      services: {
        agentContext: {
          geminiClient: undefined,
          get config() {
            return this;
          },
        },
      },
    }) as unknown as CommandContext;

    const result = rewindCommand.action!(context, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Client not initialized',
    });
  });

  it('should fail if recording service is unavailable', () => {
    const context = createMockCommandContext({
      services: {
        agentContext: {
          geminiClient: { getChatRecordingService: () => undefined },
          get config() {
            return this;
          },
        },
      },
    }) as unknown as CommandContext;

    const result = rewindCommand.action!(context, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Recording service unavailable',
    });
  });

  it('should return info if no conversation found', () => {
    mockGetConversation.mockReturnValue(null);

    const result = rewindCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'No conversation found.',
    });
  });

  it('should return info if no user interactions found', () => {
    mockGetConversation.mockReturnValue({
      messages: [{ id: 'msg-1', type: 'gemini', content: 'hello' }],
      sessionId: 'test-session',
    });

    const result = rewindCommand.action!(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: 'Nothing to rewind to.',
    });
  });
});
