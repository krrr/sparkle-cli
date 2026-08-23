/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { clearCommand } from './clearCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

// Mock the telemetry service
vi.mock('sparkle-cli-core', async () => {
  const actual = await vi.importActual('sparkle-cli-core');
  return {
    ...actual,
    uiTelemetryService: {
      setLastPromptTokenCount: vi.fn(),
      clear: vi.fn(),
    },
  };
});

import { uiTelemetryService, type GeminiClient } from 'sparkle-cli-core';
import { MessageType } from '../types.js';

describe('clearCommand', () => {
  let mockContext: CommandContext;
  let mockResetChat: ReturnType<typeof vi.fn>;
  let mockHintClear: ReturnType<typeof vi.fn>;
  let mockDeleteCurrentSession: ReturnType<typeof vi.fn>;
  let mockGetChatRecordingService: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockResetChat = vi.fn().mockResolvedValue(undefined);
    mockHintClear = vi.fn();
    mockDeleteCurrentSession = vi.fn().mockResolvedValue(undefined);
    mockGetChatRecordingService = vi
      .fn()
      .mockReturnValue({ deleteCurrentSessionAsync: mockDeleteCurrentSession });
    vi.clearAllMocks();

    mockContext = createMockCommandContext({
      services: {
        agentContext: {
          config: {
            getEnableHooks: vi.fn().mockReturnValue(false),
            resetNewSessionState: vi.fn(),
            getMessageBus: vi.fn().mockReturnValue(undefined),
            getHookSystem: vi.fn().mockReturnValue({
              fireSessionEndEvent: vi.fn().mockResolvedValue(undefined),
              fireSessionStartEvent: vi.fn().mockResolvedValue(undefined),
            }),
            injectionService: {
              clear: mockHintClear,
            },
          },
          geminiClient: {
            resetChat: mockResetChat,
            getChatRecordingService: mockGetChatRecordingService,
            getChat: () => ({
              getChatRecordingService: mockGetChatRecordingService,
            }),
          } as unknown as GeminiClient,
        },
      },
    });
  });

  it('should set debug message, reset chat, reset telemetry, clear hints, and clear UI when config is available', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    await clearCommand.action(mockContext, '');

    expect(mockContext.ui.setDebugMessage).toHaveBeenCalledWith(
      'Clearing terminal and resetting chat.',
    );
    expect(mockContext.ui.setDebugMessage).toHaveBeenCalledTimes(1);

    expect(mockResetChat).toHaveBeenCalledTimes(1);
    expect(mockHintClear).toHaveBeenCalledTimes(1);
    expect(
      mockContext.services.agentContext?.config.resetNewSessionState,
    ).toHaveBeenCalledTimes(1);
    expect(uiTelemetryService.clear).toHaveBeenCalled();
    expect(uiTelemetryService.clear).toHaveBeenCalledTimes(1);
    expect(mockContext.ui.clear).toHaveBeenCalledTimes(1);

    // Check the order of operations.
    const setDebugMessageOrder = (mockContext.ui.setDebugMessage as Mock).mock
      .invocationCallOrder[0];
    const resetChatOrder = mockResetChat.mock.invocationCallOrder[0];
    const resetTelemetryOrder = (uiTelemetryService.clear as Mock).mock
      .invocationCallOrder[0];
    const clearOrder = (mockContext.ui.clear as Mock).mock
      .invocationCallOrder[0];

    expect(setDebugMessageOrder).toBeLessThan(resetChatOrder);
    expect(resetChatOrder).toBeLessThan(resetTelemetryOrder);
    expect(resetTelemetryOrder).toBeLessThan(clearOrder);
  });

  it('should not attempt to reset chat if config service is not available', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    const nullConfigContext = createMockCommandContext({
      services: {
        agentContext: null,
      },
    });

    await clearCommand.action(nullConfigContext, '');

    expect(nullConfigContext.ui.setDebugMessage).toHaveBeenCalledWith(
      'Clearing terminal.',
    );
    expect(mockResetChat).not.toHaveBeenCalled();
    expect(uiTelemetryService.clear).toHaveBeenCalled();
    expect(uiTelemetryService.clear).toHaveBeenCalledTimes(1);
    expect(nullConfigContext.ui.clear).toHaveBeenCalledTimes(1);
  });

  it.each(['--delete', '-d'])(
    'should delete the current session record when invoked with %s',
    async (flag) => {
      if (!clearCommand.action) {
        throw new Error('clearCommand must have an action.');
      }

      await clearCommand.action(mockContext, flag);

      expect(mockDeleteCurrentSession).toHaveBeenCalledTimes(1);

      // Deletion must happen before the new session state replaces the old one.
      const deleteOrder = mockDeleteCurrentSession.mock.invocationCallOrder[0];
      const resetNewSessionStateOrder = (
        mockContext.services.agentContext?.config.resetNewSessionState as Mock
      ).mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(resetNewSessionStateOrder);

      // The confirmation message is added after the UI is cleared.
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        {
          type: MessageType.INFO,
          text: 'Previous session record deleted.',
        },
        expect.any(Number),
      );
      const clearOrder = (mockContext.ui.clear as Mock).mock
        .invocationCallOrder[0];
      const addItemOrder = (mockContext.ui.addItem as Mock).mock
        .invocationCallOrder[0];
      expect(clearOrder).toBeLessThan(addItemOrder);

      // The rest of the clear flow still runs.
      expect(mockResetChat).toHaveBeenCalledTimes(1);
      expect(mockContext.ui.clear).toHaveBeenCalledTimes(1);
    },
  );

  it('should not delete the session record when no flag is passed', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    await clearCommand.action(mockContext, '');

    expect(mockDeleteCurrentSession).not.toHaveBeenCalled();
    expect(mockContext.ui.addItem).not.toHaveBeenCalled();
  });

  it('should not block starting a new session when deletion fails', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    mockDeleteCurrentSession.mockRejectedValue(new Error('disk error'));

    await clearCommand.action(mockContext, '--delete');

    expect(mockDeleteCurrentSession).toHaveBeenCalledTimes(1);
    expect(
      mockContext.services.agentContext?.config.resetNewSessionState,
    ).toHaveBeenCalledTimes(1);
    expect(mockResetChat).toHaveBeenCalledTimes(1);
    expect(mockContext.ui.clear).toHaveBeenCalledTimes(1);
    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.ERROR,
        text: 'Failed to delete the previous session record.',
      },
      expect.any(Number),
    );
  });

  it('should do nothing when -d is passed but no chat recording service exists', async () => {
    if (!clearCommand.action) {
      throw new Error('clearCommand must have an action.');
    }

    mockGetChatRecordingService.mockReturnValue(undefined);

    await clearCommand.action(mockContext, '-d');

    expect(mockDeleteCurrentSession).not.toHaveBeenCalled();
    expect(mockContext.ui.addItem).not.toHaveBeenCalled();
    expect(mockResetChat).toHaveBeenCalledTimes(1);
    expect(mockContext.ui.clear).toHaveBeenCalledTimes(1);
  });
});
