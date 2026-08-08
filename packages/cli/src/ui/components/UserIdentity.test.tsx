/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../test-utils/render.js';
import { UserIdentity } from './UserIdentity.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  makeFakeConfig,
  AuthType,
  type ContentGeneratorConfig,
} from '@google/gemini-cli-core';

describe('<UserIdentity />', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render auth indicator', async () => {
    const mockConfig = makeFakeConfig();
    vi.spyOn(mockConfig, 'getContentGeneratorConfig').mockReturnValue({
      authType: AuthType.USE_GEMINI,
      model: 'gemini-pro',
    } as unknown as ContentGeneratorConfig);
    vi.spyOn(mockConfig, 'getUserTierName').mockReturnValue(undefined);

    const { lastFrame, unmount } = await renderWithProviders(
      <UserIdentity config={mockConfig} />,
    );

    const output = lastFrame();
    expect(output).toContain(`Authenticated with ${AuthType.USE_GEMINI}`);
    expect(output).toContain('/auth');
    expect(output).not.toContain('/upgrade');
    unmount();
  });

  it('should render plan name and upgrade indicator', async () => {
    const mockConfig = makeFakeConfig();
    vi.spyOn(mockConfig, 'getContentGeneratorConfig').mockReturnValue({
      authType: AuthType.USE_GEMINI,
      model: 'gemini-pro',
    } as unknown as ContentGeneratorConfig);
    vi.spyOn(mockConfig, 'getUserTierName').mockReturnValue('Premium Plan');

    const { lastFrame, unmount } = await renderWithProviders(
      <UserIdentity config={mockConfig} />,
    );

    const output = lastFrame();
    expect(output).toContain(`Authenticated with ${AuthType.USE_GEMINI}`);
    expect(output).toContain('/auth');
    expect(output).toContain('Plan: Premium Plan');
    expect(output).toContain('/upgrade');

    // Check for two lines (or more if wrapped, but here it should be separate)
    const lines = output?.split('\n').filter((line) => line.trim().length > 0);
    expect(lines?.some((line) => line.includes(`Authenticated with`))).toBe(
      true,
    );
    expect(lines?.some((line) => line.includes('Plan: Premium Plan'))).toBe(
      true,
    );

    unmount();
  });

  it('should not render if authType is missing', async () => {
    const mockConfig = makeFakeConfig();
    vi.spyOn(mockConfig, 'getContentGeneratorConfig').mockReturnValue(
      {} as unknown as ContentGeneratorConfig,
    );

    const { lastFrame, unmount } = await renderWithProviders(
      <UserIdentity config={mockConfig} />,
    );

    expect(lastFrame({ allowEmpty: true })).toBe('');
    unmount();
  });

  it('should render non-Google auth message', async () => {
    const mockConfig = makeFakeConfig();
    vi.spyOn(mockConfig, 'getContentGeneratorConfig').mockReturnValue({
      authType: AuthType.GATEWAY,
      model: 'gemini-pro',
    } as unknown as ContentGeneratorConfig);
    vi.spyOn(mockConfig, 'getUserTierName').mockReturnValue(undefined);

    const { lastFrame, unmount } = await renderWithProviders(
      <UserIdentity config={mockConfig} />,
    );

    const output = lastFrame();
    expect(output).toContain(`Authenticated with ${AuthType.GATEWAY}`);
    expect(output).toContain('/auth');
    expect(output).not.toContain('/upgrade');
    unmount();
  });

  it('should render specific tier name when provided', async () => {
    const mockConfig = makeFakeConfig();
    vi.spyOn(mockConfig, 'getContentGeneratorConfig').mockReturnValue({
      authType: AuthType.USE_GEMINI,
      model: 'gemini-pro',
    } as unknown as ContentGeneratorConfig);
    vi.spyOn(mockConfig, 'getUserTierName').mockReturnValue('Enterprise Tier');

    const { lastFrame, unmount } = await renderWithProviders(
      <UserIdentity config={mockConfig} />,
    );

    const output = lastFrame();
    expect(output).toContain('Plan: Enterprise Tier');
    expect(output).toContain('/upgrade');
    unmount();
  });

  it('should not render /upgrade indicator for ultra tiers', async () => {
    const mockConfig = makeFakeConfig();
    vi.spyOn(mockConfig, 'getContentGeneratorConfig').mockReturnValue({
      authType: AuthType.USE_GEMINI,
      model: 'gemini-pro',
    } as unknown as ContentGeneratorConfig);
    vi.spyOn(mockConfig, 'getUserTierName').mockReturnValue('Advanced Ultra');

    const { lastFrame, unmount } = await renderWithProviders(
      <UserIdentity config={mockConfig} />,
    );

    const output = lastFrame();
    expect(output).toContain('Plan: Advanced Ultra');
    expect(output).not.toContain('/upgrade');
    unmount();
  });
});
