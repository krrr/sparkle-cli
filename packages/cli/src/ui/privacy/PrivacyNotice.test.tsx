/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from '../../test-utils/render.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrivacyNotice } from './PrivacyNotice.js';
import type {
  AuthType,
  Config,
  ContentGeneratorConfig,
} from '@google/gemini-cli-core';

// Mock child components
vi.mock('./GeminiPrivacyNotice.js', async () => {
  const { Text } = await import('ink');
  return {
    GeminiPrivacyNotice: () => <Text>GeminiPrivacyNotice</Text>,
  };
});

vi.mock('./CloudFreePrivacyNotice.js', async () => {
  const { Text } = await import('ink');
  return {
    CloudFreePrivacyNotice: () => <Text>CloudFreePrivacyNotice</Text>,
  };
});

describe('PrivacyNotice', () => {
  const onExit = vi.fn();
  const mockConfig = {
    getContentGeneratorConfig: vi.fn(),
  } as unknown as Config;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    {
      authType: 'gemini-api-key' as AuthType,
      expectedComponent: 'GeminiPrivacyNotice',
    },
    {
      authType: 'gateway' as AuthType,
      expectedComponent: 'CloudFreePrivacyNotice',
    },
    {
      authType: 'UNKNOWN' as AuthType,
      expectedComponent: 'CloudFreePrivacyNotice',
    },
  ])(
    'renders $expectedComponent when authType is $authType',
    async ({ authType, expectedComponent }) => {
      vi.mocked(mockConfig.getContentGeneratorConfig).mockReturnValue({
        authType,
      } as unknown as ContentGeneratorConfig);

      const { lastFrame, unmount } = await render(
        <PrivacyNotice config={mockConfig} onExit={onExit} />,
      );

      expect(lastFrame()).toContain(expectedComponent);
      unmount();
    },
  );
});
