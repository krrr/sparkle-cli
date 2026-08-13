/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { AppHeader } from './AppHeader.js';

// We mock the entire module to control the isAppleTerminal export
vi.mock('sparkle-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sparkle-cli-core')>();
  return {
    ...actual,
    isAppleTerminal: vi.fn(),
  };
});

describe('AppHeader Icon Rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders the default icon in standard terminals', async () => {
    const result = await renderWithProviders(<AppHeader version="1.0.0" />);
    await result.waitUntilReady();

    await expect(result).toMatchSvgSnapshot();
  });
});
