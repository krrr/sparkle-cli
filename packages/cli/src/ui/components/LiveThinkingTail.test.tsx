/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import {
  LiveThinkingTail,
  getLiveThinkingTailLines,
} from './LiveThinkingTail.js';

describe('LiveThinkingTail', () => {
  it('renders only the trailing lines of the accumulated reasoning', async () => {
    const renderResult = await renderWithProviders(
      <LiveThinkingTail
        text={'first line\nsecond line\nthird line\nfourth line'}
        terminalWidth={80}
      />,
    );
    await renderResult.waitUntilReady();

    const output = renderResult.lastFrame();
    expect(output).toContain('second line');
    expect(output).toContain('third line');
    expect(output).toContain('fourth line');
    expect(output).not.toContain('first line');
    renderResult.unmount();
  });

  it('filters out noise lines and strips ANSI escapes', async () => {
    const renderResult = await renderWithProviders(
      <LiveThinkingTail
        text={'...\n\u001b[31mred reasoning\u001b[0m\n\n'}
        terminalWidth={80}
      />,
    );
    await renderResult.waitUntilReady();

    const output = renderResult.lastFrame();
    expect(output).toContain('red reasoning');
    expect(output).not.toContain('\u001b[31m');
    renderResult.unmount();
  });

  it('keeps leading indentation but trims trailing whitespace', async () => {
    const renderResult = await renderWithProviders(
      <LiveThinkingTail
        text={'    indented detail stays   \n\ttab-indented line\t\nplain line'}
        terminalWidth={80}
      />,
    );
    await renderResult.waitUntilReady();

    const output = renderResult.lastFrame();
    // OpenAI path: leading whitespace survives into the frame so reasoning
    // structure is preserved; trailing whitespace is trimmed away.
    expect(output).toContain('    indented detail stays');
    renderResult.unmount();
  });

  it('normalizes lines keeping indentation verbatim and trimming only trailing whitespace', () => {
    expect(
      getLiveThinkingTailLines(
        '    indented detail stays   \n\ttab-indented line\t\n  \n...\nplain line',
        5,
      ),
    ).toEqual([
      '    indented detail stays',
      '\ttab-indented line',
      'plain line',
    ]);
  });

  it('renders nothing for null or empty text', async () => {
    const renderResult = await renderWithProviders(
      <LiveThinkingTail text={null} terminalWidth={80} />,
    );
    await renderResult.waitUntilReady();

    expect(renderResult.lastFrame({ allowEmpty: true })?.trim()).toBe('');
    renderResult.unmount();
  });
});
