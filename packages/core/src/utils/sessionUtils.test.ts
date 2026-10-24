/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import {
  convertSessionToClientHistory,
  isIgnoredUserContent,
  isInjectedContextContent,
  isUserPromptMessage,
} from './sessionUtils.js';
import {
  type ConversationRecord,
  type MessageRecord,
} from '../services/chatRecordingService.js';
import { CoreToolCallStatus } from '../scheduler/types.js';

describe('convertSessionToClientHistory', () => {
  it('should convert a simple conversation without tool calls', () => {
    const messages: ConversationRecord['messages'] = [
      {
        id: '1',
        type: 'user',
        timestamp: '2024-01-01T10:00:00Z',
        content: 'Hello',
      },
      {
        id: '2',
        type: 'gemini',
        timestamp: '2024-01-01T10:01:00Z',
        content: 'Hi there',
      },
    ];

    const history = convertSessionToClientHistory(messages);

    expect(history.map((h) => h.content)).toEqual([
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi there' }] },
    ]);
  });

  it('should convert thinking tokens (thoughts) to model parts', () => {
    const messages: ConversationRecord['messages'] = [
      {
        id: '1',
        type: 'user',
        timestamp: '2024-01-01T10:00:00Z',
        content: 'Hello',
      },
      {
        id: '2',
        type: 'gemini',
        timestamp: '2024-01-01T10:01:00Z',
        content: 'Hi there',
        thoughts: [
          {
            subject: 'Thinking',
            description: 'I should be polite.',
            timestamp: '2024-01-01T10:00:50Z',
          },
        ],
      },
    ];

    const history = convertSessionToClientHistory(messages);

    expect(history.map((h) => h.content)).toEqual([
      { role: 'user', parts: [{ text: 'Hello' }] },
      {
        role: 'model',
        parts: [
          { text: '**Thinking** I should be polite.', thought: true },
          { text: 'Hi there' },
        ],
      },
    ]);
  });

  it('should ignore info, error, and slash commands', () => {
    const messages: ConversationRecord['messages'] = [
      {
        id: '1',
        type: 'info',
        timestamp: '2024-01-01T10:00:00Z',
        content: 'System info',
      },
      {
        id: '2',
        type: 'user',
        timestamp: '2024-01-01T10:01:00Z',
        content: '/clear',
      },
      {
        id: '3',
        type: 'user',
        timestamp: '2024-01-01T10:02:00Z',
        content: '?help',
      },
      {
        id: '4',
        type: 'user',
        timestamp: '2024-01-01T10:03:00Z',
        content: 'Actual query',
      },
    ];

    const history = convertSessionToClientHistory(messages);

    expect(history.map((h) => h.content)).toEqual([
      { role: 'user', parts: [{ text: 'Actual query' }] },
    ]);
  });

  it('should ignore <session_context> and <hook_context>', () => {
    const messages: ConversationRecord['messages'] = [
      {
        id: '1',
        type: 'user',
        timestamp: '2024-01-01T10:00:00Z',
        content: '<session_context>\nOld context\n</session_context>',
      },
      {
        id: '2',
        type: 'user',
        timestamp: '2024-01-01T10:01:00Z',
        content: '<hook_context>\nOld hook context\n</hook_context>',
      },
      {
        id: '3',
        type: 'user',
        timestamp: '2024-01-01T10:02:00Z',
        content: 'Actual query',
      },
    ];

    const history = convertSessionToClientHistory(messages);

    expect(history.map((h) => h.content)).toEqual([
      { role: 'user', parts: [{ text: 'Actual query' }] },
    ]);
  });

  it('should map tool calls to model parts without synthesizing responses', () => {
    const messages: ConversationRecord['messages'] = [
      {
        id: 'msg1',
        type: 'user',
        timestamp: '2024-01-01T10:00:00Z',
        content: 'List files',
      },
      {
        id: 'msg2',
        type: 'gemini',
        timestamp: '2024-01-01T10:01:00Z',
        content: 'Let me check.',
        toolCalls: [
          {
            id: 'call123',
            name: 'ls',
            args: { dir: '.' },
            status: CoreToolCallStatus.Success,
            timestamp: '2024-01-01T10:01:05Z',
          },
        ],
      },
    ];

    const history = convertSessionToClientHistory(messages);

    expect(history.map((h) => h.content)).toEqual([
      { role: 'user', parts: [{ text: 'List files' }] },
      {
        role: 'model',
        parts: [
          { text: 'Let me check.' },
          { functionCall: { name: 'ls', args: { dir: '.' }, id: 'call123' } },
        ],
      },
    ]);
  });

  it('should preserve recorded user functionResponse messages', () => {
    const messages: ConversationRecord['messages'] = [
      {
        id: 'msg1',
        type: 'user',
        timestamp: '2024-01-01T10:00:00Z',
        content: 'List files',
      },
      {
        id: 'msg2',
        type: 'gemini',
        timestamp: '2024-01-01T10:01:00Z',
        content: 'Let me check.',
        toolCalls: [
          {
            id: 'call123',
            name: 'ls',
            args: { dir: '.' },
            status: CoreToolCallStatus.Success,
            timestamp: '2024-01-01T10:01:05Z',
          },
        ],
      },
      {
        id: 'msg3',
        type: 'user',
        timestamp: '2024-01-01T10:02:00Z',
        content: [
          {
            functionResponse: {
              id: 'call123',
              name: 'ls',
              response: { output: 'file.txt' },
            },
          },
        ],
      },
    ];

    const history = convertSessionToClientHistory(messages);

    expect(history.map((h) => h.content)).toEqual([
      { role: 'user', parts: [{ text: 'List files' }] },
      {
        role: 'model',
        parts: [
          { text: 'Let me check.' },
          { functionCall: { name: 'ls', args: { dir: '.' }, id: 'call123' } },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'call123',
              name: 'ls',
              response: { output: 'file.txt' },
            },
          },
        ],
      },
    ]);
  });

  it('should deduplicate messages that share the same id', () => {
    const messages: ConversationRecord['messages'] = [
      {
        id: 'dup1',
        type: 'user',
        timestamp: '2024-01-01T10:00:00Z',
        content: 'Hello',
      },
      {
        id: 'dup1',
        type: 'user',
        timestamp: '2024-01-01T10:00:00Z',
        content: 'Hello',
      },
    ];

    const history = convertSessionToClientHistory(messages);

    expect(history).toHaveLength(1);
    expect(history.map((h) => h.content)).toEqual([
      { role: 'user', parts: [{ text: 'Hello' }] },
    ]);
  });

  it('should preserve multi-modal parts (inlineData)', () => {
    const messages: ConversationRecord['messages'] = [
      {
        id: 'msg1',
        type: 'user',
        timestamp: '2024-01-01T10:00:00Z',
        content: [
          { text: 'Look at this image' },
          { inlineData: { mimeType: 'image/png', data: 'base64data' } },
        ],
      },
    ];

    const history = convertSessionToClientHistory(messages);

    expect(history.map((h) => h.content)).toEqual([
      {
        role: 'user',
        parts: [
          { text: 'Look at this image' },
          { inlineData: { mimeType: 'image/png', data: 'base64data' } },
        ],
      },
    ]);
  });
});

describe('injected user context', () => {
  const userMessage = (content: MessageRecord['content']): MessageRecord => ({
    id: 'msg-1',
    timestamp: new Date(0).toISOString(),
    type: 'user',
    content,
  });

  describe('isIgnoredUserContent', () => {
    it('ignores empty content and slash/help commands', () => {
      expect(isIgnoredUserContent('')).toBe(true);
      expect(isIgnoredUserContent('/help')).toBe(true);
      expect(isIgnoredUserContent('?model')).toBe(true);
    });

    it('ignores injected context turns', () => {
      expect(
        isIgnoredUserContent('<session_context>\nToday is Monday\n</session_context>'),
      ).toBe(true);
      expect(isIgnoredUserContent('<hook_context>hook output</hook_context>')).toBe(
        true,
      );
      expect(
        isIgnoredUserContent(
          '\n<loaded_context>\n<project_context>\nAGENTS.md\n</project_context>\n</loaded_context>',
        ),
      ).toBe(true);
    });

    it('ignores injected context without a closing tag', () => {
      // Truncated/legacy context turns still lead with their tag.
      expect(isIgnoredUserContent('<session_context>\nToday is Monday')).toBe(true);
    });

    it('keeps regular prompts', () => {
      expect(isIgnoredUserContent('Fix the rewind turn stats')).toBe(false);
    });

    it('keeps prompts that merely mention an injected context tag', () => {
      expect(
        isIgnoredUserContent('Why does <loaded_context> appear in my transcript?'),
      ).toBe(false);
    });
  });

  describe('isInjectedContextContent', () => {
    it('recognizes injected context turns by their leading tag', () => {
      expect(
        isInjectedContextContent(
          '<session_context>\nToday is Monday\n</session_context>',
        ),
      ).toBe(true);
      expect(isInjectedContextContent('<hook_context>hook</hook_context>')).toBe(true);
      expect(
        isInjectedContextContent(
          '\n<loaded_context>\n<project_context>\nAGENTS.md\n</project_context>\n</loaded_context>',
        ),
      ).toBe(true);
    });

    it('does not treat slash commands or plain prompts as injected context', () => {
      // The UI history keeps what the user actually typed.
      expect(isInjectedContextContent('/help')).toBe(false);
      expect(isInjectedContextContent('Audit the docs')).toBe(false);
      expect(isInjectedContextContent('')).toBe(false);
    });
  });

  describe('isUserPromptMessage', () => {
    it('rejects tool responses recorded as user messages', () => {
      expect(
        isUserPromptMessage(
          userMessage([
            {
              functionResponse: {
                id: 'read_file__call_00',
                name: 'read_file',
                response: { output: 'ok' },
              },
            },
          ]),
        ),
      ).toBe(false);
    });

    it('rejects injected context and slash commands', () => {
      expect(
        isUserPromptMessage(
          userMessage([{ text: '<hook_context>hook output</hook_context>' }]),
        ),
      ).toBe(false);
      expect(isUserPromptMessage(userMessage([{ text: '/rewind' }]))).toBe(false);
    });

    it('rejects non-user messages', () => {
      const modelMessage: MessageRecord = {
        id: 'msg-2',
        timestamp: new Date(0).toISOString(),
        type: 'gemini',
        content: [{ text: 'Sure' }],
      };
      expect(isUserPromptMessage(modelMessage)).toBe(false);
    });

    it('rejects runtime notifications injected as user turns', () => {
      expect(
        isUserPromptMessage(
          userMessage([
            {
              text: 'Background execution update:\n<background_output>\nbuild ok\n</background_output>\n\nA previously backgrounded execution has completed.',
            },
          ]),
        ),
      ).toBe(false);
      expect(
        isUserPromptMessage(
          userMessage([
            {
              text: 'User hints:\n<user_input>\n- stop that work\n</user_input>\n\nInternal instruction: …',
            },
          ]),
        ),
      ).toBe(false);
    });

    it('accepts real prompts', () => {
      expect(isUserPromptMessage(userMessage([{ text: 'Fix the bug' }]))).toBe(true);
    });

    it('accepts a prompt whose injected context arrived as its own turn', () => {
      // Regression guard: injected context must stay a separate turn. If a
      // producer merges it into the prompt turn again, the prompt becomes
      // indistinguishable from injected context and is silently dropped.
      const messages: MessageRecord[] = [
        {
          id: 'env-turn',
          timestamp: new Date(0).toISOString(),
          type: 'user',
          content: [
            {
              text: '\n<loaded_context>\n<project_context>\nAGENTS.md\n</project_context>\n</loaded_context>',
            },
          ],
        },
        {
          id: 'prompt-turn',
          timestamp: new Date(0).toISOString(),
          type: 'user',
          content: [{ text: 'Audit the docs' }],
        },
      ];

      expect(messages.filter(isUserPromptMessage)).toHaveLength(1);
      expect(messages.filter(isUserPromptMessage)[0].id).toBe('prompt-turn');
    });
  });

  describe('convertSessionToClientHistory', () => {
    it('drops a standalone environment context turn', () => {
      const history = convertSessionToClientHistory([
        userMessage([
          { text: '<session_context>\nToday is Monday\n</session_context>' },
        ]),
      ]);

      expect(history).toEqual([]);
    });

    it('keeps a prompt that follows a separate loaded-context turn', () => {
      const history = convertSessionToClientHistory([
        {
          id: 'env-turn',
          timestamp: new Date(0).toISOString(),
          type: 'user',
          content: [
            {
              text: '\n<loaded_context>\n<project_context>\nAGENTS.md\n</project_context>\n</loaded_context>',
            },
          ],
        },
        {
          id: 'prompt-turn',
          timestamp: new Date(0).toISOString(),
          type: 'user',
          content: [{ text: 'Audit the docs' }],
        },
      ]);

      expect(history).toHaveLength(1);
      expect(history[0].id).toBe('prompt-turn');
      expect(history[0].content.role).toBe('user');
    });
  });
});
