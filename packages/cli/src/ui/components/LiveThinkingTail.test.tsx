/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { cleanup, renderWithProviders } from '../../test-utils/render.js';
import { LiveThinkingTail, getLiveThinkingTailLines } from './LiveThinkingTail.js';
import { updateLiveThought, resetLiveThought } from '../hooks/useLiveThought.js';

describe('LiveThinkingTail', () => {
  beforeEach(() => {
    resetLiveThought();
  });

  afterEach(() => {
    cleanup();
    resetLiveThought();
  });

  it('renders only the trailing lines of the accumulated reasoning', async () => {
    updateLiveThought('first line\nsecond line\nthird line\nfourth line');
    const renderResult = await renderWithProviders(
      <LiveThinkingTail terminalWidth={80} />,
    );
    await renderResult.waitUntilReady();

    const output = renderResult.lastFrame();
    expect(output).toContain('second line');
    expect(output).toContain('third line');
    expect(output).toContain('fourth line');
    expect(output).not.toContain('first line');
  });

  it('filters out noise lines and strips ANSI escapes', async () => {
    updateLiveThought('...\n\u001b[31mred reasoning\u001b[0m\n\n');
    const renderResult = await renderWithProviders(
      <LiveThinkingTail terminalWidth={80} />,
    );
    await renderResult.waitUntilReady();

    const output = renderResult.lastFrame();
    expect(output).toContain('red reasoning');
    expect(output).not.toContain('\u001b[31m');
  });

  it('keeps leading indentation but trims trailing whitespace', async () => {
    updateLiveThought(
      '    indented detail stays   \n\ttab-indented line\t\nplain line',
    );
    const renderResult = await renderWithProviders(
      <LiveThinkingTail terminalWidth={80} />,
    );
    await renderResult.waitUntilReady();

    const output = renderResult.lastFrame();
    // OpenAI path: leading whitespace survives into the frame so reasoning
    // structure is preserved; trailing whitespace is trimmed away.
    expect(output).toContain('    indented detail stays');
  });

  it('normalizes lines keeping indentation verbatim and trimming only trailing whitespace', () => {
    expect(
      getLiveThinkingTailLines(
        '    indented detail stays   \n\ttab-indented line\t\n  \n...\nplain line',
        5,
      ),
    ).toEqual(['    indented detail stays', '\ttab-indented line', 'plain line']);
  });

  it('renders nothing for null or empty text', async () => {
    const renderResult = await renderWithProviders(
      <LiveThinkingTail terminalWidth={80} />,
    );
    await renderResult.waitUntilReady();

    expect(renderResult.lastFrame({ allowEmpty: true })?.trim()).toBe('');
  });

  it('re-renders when the live thought store updates while mounted', async () => {
    const renderResult = await renderWithProviders(
      <LiveThinkingTail terminalWidth={80} />,
    );
    await renderResult.waitUntilReady();
    expect(renderResult.lastFrame({ allowEmpty: true })?.trim()).toBe('');

    await act(async () => {
      updateLiveThought('streaming reasoning line');
    });
    await renderResult.waitUntilReady();

    expect(renderResult.lastFrame()).toContain('streaming reasoning line');
  });

  it('wraps a long unbroken reasoning line instead of truncating it', async () => {
    const longLine = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    updateLiveThought(longLine);
    const renderResult = await renderWithProviders(
      <LiveThinkingTail terminalWidth={60} />,
    );
    await renderResult.waitUntilReady();

    const frame = renderResult.lastFrame();
    // No ellipsis: the text is wrapped, not cut off.
    expect(frame).not.toContain('…');
    // The most recent text is on screen, which is what makes the tail useful
    // while the model streams a line without newlines.
    expect(frame).toContain('word39');
    expect(frame.split('\n').filter((line) => line.trim() !== '').length).toBe(3);
  });

  it('keeps showing new text as a single line streams past the visible rows', async () => {
    const renderResult = await renderWithProviders(
      <LiveThinkingTail terminalWidth={60} />,
    );
    await renderResult.waitUntilReady();

    await act(async () => {
      updateLiveThought(Array.from({ length: 40 }, (_, i) => `early${i}`).join(' '));
    });
    await renderResult.waitUntilReady();
    const earlyFrame = renderResult.lastFrame();
    expect(earlyFrame).toContain('early39');

    await act(async () => {
      updateLiveThought(
        `${Array.from({ length: 40 }, (_, i) => `early${i}`).join(' ')} ${Array.from(
          { length: 40 },
          (_, i) => `late${i}`,
        ).join(' ')}`,
      );
    });
    await renderResult.waitUntilReady();
    const lateFrame = renderResult.lastFrame();

    // The display is not frozen on the start of the line: it follows the tail.
    expect(lateFrame).toContain('late39');
    expect(lateFrame).not.toContain('early0 ');
  });

  it('never blanks the tail out while the sliding window changes height', async () => {
    // Regression: pinning the tail by measuring the content (ResizeObserver +
    // negative margin) lagged one frame behind the render. When the window's
    // height shrank, the stale offset pushed every row out of the clip, so the
    // tail vanished for a single frame and the composer jumped up with it.
    const LINE_LENGTHS = [2, 40, 2, 2, 45, 3, 2, 2, 50, 2, 3, 2, 42, 2];
    const stream: string[] = [];
    let accumulated = '';
    for (const length of LINE_LENGTHS) {
      accumulated += Array.from({ length }, (_, i) => `w${i}`).join(' ') + '\n';
      stream.push(accumulated);
    }

    const renderResult = await renderWithProviders(
      <LiveThinkingTail terminalWidth={60} />,
    );
    await renderResult.waitUntilReady();

    const renderedRowCounts: number[] = [];
    renderResult.stdout.on('render', () => {
      const raw = renderResult.lastFrameRaw({ allowEmpty: true });
      renderedRowCounts.push(
        raw.split('\n').filter((line) => line.trim() !== '').length,
      );
    });

    for (const text of stream) {
      await act(async () => {
        updateLiveThought(text);
      });
      await renderResult.waitUntilReady();
    }

    expect(renderedRowCounts).not.toContain(0);
  });
});
