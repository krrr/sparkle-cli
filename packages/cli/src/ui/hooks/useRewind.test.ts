/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import { useRewind } from './useRewind.js';
import {
  type ConversationRecord,
  type FileChangeStats,
  type MessageRecord,
  calculateRewindImpact,
  calculateTurnStats,
} from 'sparkle-cli-core';

// Mock the dependency
vi.mock('sparkle-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sparkle-cli-core')>();
  return {
    ...actual,
    calculateTurnStats: vi.fn(),
    calculateRewindImpact: vi.fn(),
  };
});

describe('useRewindLogic', () => {
  const mockUserMessage: MessageRecord = {
    id: 'msg-1',
    type: 'user',
    content: 'Hello',
    timestamp: new Date(1000).toISOString(),
  };

  const mockModelMessage: MessageRecord = {
    id: 'msg-2',
    type: 'gemini',
    content: 'Hi there',
    timestamp: new Date(1001).toISOString(),
  };

  const mockConversation: ConversationRecord = {
    sessionId: 'conv-1',
    projectHash: 'hash-1',
    startTime: new Date(1000).toISOString(),
    lastUpdated: new Date(1001).toISOString(),
    messages: [mockUserMessage, mockModelMessage],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with no selection', async () => {
    const { result } = await renderHook(() => useRewind(mockConversation));

    expect(result.current.selectedMessageId).toBeNull();
    expect(result.current.confirmationStats).toBeNull();
  });

  it('should update state when a message is selected', async () => {
    const mockStats: FileChangeStats = {
      fileCount: 1,
      addedLines: 5,
      removedLines: 0,
    };
    vi.mocked(calculateRewindImpact).mockReturnValue(mockStats);

    const { result } = await renderHook(() => useRewind(mockConversation));

    act(() => {
      result.current.selectMessage('msg-1');
    });

    expect(result.current.selectedMessageId).toBe('msg-1');
    expect(result.current.confirmationStats).toEqual(mockStats);
    expect(calculateRewindImpact).toHaveBeenCalledWith(
      mockConversation,
      mockUserMessage,
    );
  });

  it('should not update state if selected message is not found', async () => {
    const { result } = await renderHook(() => useRewind(mockConversation));

    act(() => {
      result.current.selectMessage('non-existent-id');
    });

    expect(result.current.selectedMessageId).toBeNull();
    expect(result.current.confirmationStats).toBeNull();
  });

  it('should clear selection correctly', async () => {
    const mockStats: FileChangeStats = {
      fileCount: 1,
      addedLines: 5,
      removedLines: 0,
    };
    vi.mocked(calculateRewindImpact).mockReturnValue(mockStats);

    const { result } = await renderHook(() => useRewind(mockConversation));

    // Select first
    act(() => {
      result.current.selectMessage('msg-1');
    });
    expect(result.current.selectedMessageId).toBe('msg-1');

    // Then clear
    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selectedMessageId).toBeNull();
    expect(result.current.confirmationStats).toBeNull();
  });

  it('should proxy getStats call to utility function', async () => {
    const mockStats: FileChangeStats = {
      fileCount: 2,
      addedLines: 10,
      removedLines: 2,
    };
    vi.mocked(calculateTurnStats).mockReturnValue(mockStats);

    const { result } = await renderHook(() => useRewind(mockConversation));

    const stats = result.current.getStats(mockUserMessage);

    expect(stats).toEqual(mockStats);
    expect(calculateTurnStats).toHaveBeenCalledWith(mockConversation, mockUserMessage);
  });
});
