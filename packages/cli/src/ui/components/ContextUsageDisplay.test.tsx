/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../test-utils/render.js';
import { ContextUsageDisplay } from './ContextUsageDisplay.js';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { makeFakeConfig } from 'sparkle-cli-core';

describe('ContextUsageDisplay', () => {
  const config = makeFakeConfig();

  beforeAll(() => {
    // The fake model ('gemini-9001-super-duper') has no definition, so pin a
    // small context window to keep percentage assertions simple.
    vi.spyOn(
      config.getModelConfigService(),
      'getContextWindow',
    ).mockReturnValue(10000);
  });

  it('renders correct percentage used', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ContextUsageDisplay promptTokenCount={5000} terminalWidth={120} />,
      { config },
    );
    const output = lastFrame();
    expect(output).toContain('50% used');
    unmount();
  });

  it('renders correctly when usage is 0%', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ContextUsageDisplay promptTokenCount={0} terminalWidth={120} />,
      { config },
    );
    const output = lastFrame();
    expect(output).toContain('0% used');
    unmount();
  });

  it('renders abbreviated label when terminal width is small', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ContextUsageDisplay promptTokenCount={2000} terminalWidth={80} />,
      { width: 80, config },
    );
    const output = lastFrame();
    expect(output).toContain('20%');
    expect(output).not.toContain('context used');
    unmount();
  });

  it('renders 80% correctly', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ContextUsageDisplay promptTokenCount={8000} terminalWidth={120} />,
      { config },
    );
    const output = lastFrame();
    expect(output).toContain('80% used');
    unmount();
  });

  it('renders 100% when full', async () => {
    const { lastFrame, unmount } = await renderWithProviders(
      <ContextUsageDisplay promptTokenCount={10000} terminalWidth={120} />,
      { config },
    );
    const output = lastFrame();
    expect(output).toContain('100% used');
    unmount();
  });
});
