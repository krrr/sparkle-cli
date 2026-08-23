/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../test-utils/render.js';
import { StatusRow } from './StatusRow.js';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useComposerStatus } from '../hooks/useComposerStatus.js';
import { type UIState } from '../contexts/UIStateContext.js';

import { type SessionStatsState } from '../contexts/SessionContext.js';
import { type ThoughtSummary } from '../types.js';
import { ApprovalMode, CoreToolCallStatus } from 'sparkle-cli-core';

vi.mock('../hooks/useComposerStatus.js', () => ({
  useComposerStatus: vi.fn(),
}));

describe('<StatusRow />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultUiState: Partial<UIState> = {
    currentTip: undefined,
    thought: null,
    elapsedTime: 0,
    currentWittyPhrase: undefined,
    activeHooks: [],
    sessionStats: { lastPromptTokenCount: 0 } as unknown as SessionStatsState,
    shortcutsHelpVisible: false,
    contextFileNames: [],
    showApprovalModeIndicator: ApprovalMode.DEFAULT,
    allowPlanMode: false,
    renderMarkdown: true,
    currentModel: 'gemini-3',
  };

  it('renders status and tip correctly when they both fit', async () => {
    (useComposerStatus as Mock).mockReturnValue({
      isInteractiveShellWaiting: false,
      showLoadingIndicator: true,
      showTips: true,
      showWit: true,
      modeContentObj: null,
      showMinimalContext: false,
    });

    const uiState: Partial<UIState> = {
      ...defaultUiState,
      currentTip: 'Test Tip',
      thought: { subject: 'Thinking...' } as unknown as ThoughtSummary,
      elapsedTime: 5,
      currentWittyPhrase: 'I am witty',
    };

    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <StatusRow
        showUiDetails={false}
        isNarrow={false}
        terminalWidth={100}
        hideContextSummary={false}
        hideUiDetailsForSuggestions={false}
        hasPendingActionRequired={false}
      />,
      {
        width: 100,
        uiState,
      },
    );

    await waitUntilReady();
    const output = lastFrame();
    expect(output).toContain('Thinking...');
    expect(output).toContain('I am witty');
    expect(output).toContain('Tip: Test Tip');
  });

  it('renders correctly when interactive shell is waiting', async () => {
    (useComposerStatus as Mock).mockReturnValue({
      isInteractiveShellWaiting: true,
      showLoadingIndicator: false,
      showTips: false,
      showWit: false,
      modeContentObj: null,
      showMinimalContext: false,
    });

    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <StatusRow
        showUiDetails={true}
        isNarrow={false}
        terminalWidth={100}
        hideContextSummary={false}
        hideUiDetailsForSuggestions={false}
        hasPendingActionRequired={false}
      />,
      {
        width: 100,
        uiState: defaultUiState,
      },
    );

    await waitUntilReady();
    expect(lastFrame()).toContain('! Shell awaiting input (Tab to focus)');
  });

  it('renders tip with absolute positioning when it fits but might collide (verification of container logic)', async () => {
    (useComposerStatus as Mock).mockReturnValue({
      isInteractiveShellWaiting: false,
      showLoadingIndicator: true,
      showTips: true,
      showWit: true,
      modeContentObj: null,
      showMinimalContext: false,
    });

    const uiState: Partial<UIState> = {
      ...defaultUiState,
      currentTip: 'Test Tip',
    };

    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <StatusRow
        showUiDetails={false}
        isNarrow={false}
        terminalWidth={100}
        hideContextSummary={false}
        hideUiDetailsForSuggestions={false}
        hasPendingActionRequired={false}
      />,
      {
        width: 100,
        uiState,
      },
    );

    await waitUntilReady();
    expect(lastFrame()).toContain('Tip: Test Tip');
  });

  it('renders "Executing..." when a tool is currently executing', async () => {
    (useComposerStatus as Mock).mockReturnValue({
      isInteractiveShellWaiting: false,
      showLoadingIndicator: true,
      showTips: true,
      showWit: true,
      modeContentObj: null,
      showMinimalContext: false,
    });

    const uiState: Partial<UIState> = {
      ...defaultUiState,
      pendingHistoryItems: [
        {
          type: 'tool_group',
          tools: [
            {
              callId: 'call-1',
              name: 'replace',
              status: CoreToolCallStatus.Executing,
              description: '',
              resultDisplay: undefined,
              confirmationDetails: undefined,
            },
          ],
        },
      ],
    };

    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <StatusRow
        showUiDetails={false}
        isNarrow={false}
        terminalWidth={100}
        hideContextSummary={false}
        hideUiDetailsForSuggestions={false}
        hasPendingActionRequired={false}
      />,
      {
        width: 100,
        uiState,
      },
    );

    await waitUntilReady();
    expect(lastFrame()).toContain('Executing...');
    expect(lastFrame()).not.toContain('Thinking...');
  });

  it('keeps the tip on the status line while the live reasoning tail renders on its own row', async () => {
    (useComposerStatus as Mock).mockReturnValue({
      isInteractiveShellWaiting: false,
      showLoadingIndicator: true,
      showTips: true,
      showWit: false,
      modeContentObj: null,
      showMinimalContext: false,
    });

    const uiState: Partial<UIState> = {
      ...defaultUiState,
      currentTip: 'Test Tip',
      liveThought: 'analyzing the request\nchecking the files',
    };

    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <StatusRow
        showUiDetails={false}
        isNarrow={false}
        terminalWidth={100}
        hideContextSummary={false}
        hideUiDetailsForSuggestions={false}
        hasPendingActionRequired={false}
      />,
      {
        width: 100,
        uiState,
      },
    );

    await waitUntilReady();
    const output = lastFrame();
    expect(output).toContain('analyzing the request');
    expect(output).toContain('checking the files');
    expect(output).toContain('Tip: Test Tip');
    // The tip shares the first line with the status; the tail starts on the
    // line directly below it.
    const lines = output.split('\n');
    const tipLineIndex = lines.findIndex((line) =>
      line.includes('Tip: Test Tip'),
    );
    const firstTailLineIndex = lines.findIndex((line) =>
      line.includes('analyzing the request'),
    );
    expect(tipLineIndex).toBeGreaterThanOrEqual(0);
    expect(firstTailLineIndex).toBe(tipLineIndex + 1);
  });

  it('hides the live reasoning tail while hooks are executing', async () => {
    (useComposerStatus as Mock).mockReturnValue({
      isInteractiveShellWaiting: false,
      showLoadingIndicator: true,
      showTips: true,
      showWit: false,
      modeContentObj: null,
      showMinimalContext: false,
    });

    const uiState: Partial<UIState> = {
      ...defaultUiState,
      liveThought: 'stale reasoning text',
      activeHooks: [
        {
          eventName: 'test-ev',
          source: 'test',
          name: 'my-hook',
          index: 1,
          total: 1,
        },
      ],
    };

    const { lastFrame, waitUntilReady } = await renderWithProviders(
      <StatusRow
        showUiDetails={false}
        isNarrow={false}
        terminalWidth={100}
        hideContextSummary={false}
        hideUiDetailsForSuggestions={false}
        hasPendingActionRequired={false}
      />,
      {
        width: 100,
        uiState,
      },
    );

    await waitUntilReady();
    const output = lastFrame();
    expect(output).toContain('Executing Hook');
    expect(output).not.toContain('stale reasoning text');
  });
});
