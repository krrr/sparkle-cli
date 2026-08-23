/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveThirdPartySearchProvider,
  formatThirdPartySearchResults,
} from './third-party-search.js';
import { ExaSearchProvider } from './exa-search.js';
import type { Config, WebSearchConfig } from '../../config/config.js';

vi.mock('./exa-search.js', () => ({
  ExaSearchProvider: vi.fn().mockImplementation((apiKey: string) => ({
    name: 'exa',
    apiKey,
  })),
}));

function makeConfig(
  webSearchConfig: WebSearchConfig | undefined,
  env?: Record<string, string>,
) {
  return {
    getWebSearchConfig: () => webSearchConfig,
    env,
  } as unknown as Config;
}

describe('resolveThirdPartySearchProvider', () => {
  beforeEach(() => {
    vi.mocked(ExaSearchProvider).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should report missing provider when nothing is configured', () => {
    const result = resolveThirdPartySearchProvider(makeConfig(undefined));

    expect(result.provider).toBeUndefined();
    expect(result.reason).toContain('tools.webSearch.thirdPartyProvider');
  });

  it('should report unknown provider ids', () => {
    const result = resolveThirdPartySearchProvider(
      makeConfig({ thirdPartyProvider: 'unknown-provider', apiKey: 'k' }),
    );

    expect(result.provider).toBeUndefined();
    expect(result.reason).toContain('unknown-provider');
    expect(result.reason).toContain('exa');
  });

  it('should report a missing API key with the provider env var hint', () => {
    const result = resolveThirdPartySearchProvider(
      makeConfig({ thirdPartyProvider: 'exa' }),
    );

    expect(result.provider).toBeUndefined();
    expect(result.reason).toContain('EXA_API_KEY');
    expect(result.reason).toContain('tools.webSearch.apiKey');
  });

  it('should build the provider from the settings API key', () => {
    const result = resolveThirdPartySearchProvider(
      makeConfig({ thirdPartyProvider: 'exa', apiKey: 'settings-key' }),
    );

    expect(result.reason).toBeUndefined();
    expect(ExaSearchProvider).toHaveBeenCalledWith('settings-key');
    expect(result.provider?.name).toBe('exa');
  });

  it('should prefer the env var from config.env over the settings value', () => {
    const result = resolveThirdPartySearchProvider(
      makeConfig(
        { thirdPartyProvider: 'exa', apiKey: 'settings-key' },
        { EXA_API_KEY: 'env-key' },
      ),
    );

    expect(result.provider).toBeDefined();
    expect(ExaSearchProvider).toHaveBeenCalledWith('env-key');
  });

  it('should fall back to the process env var when config.env is unset', () => {
    vi.stubEnv('EXA_API_KEY', 'process-env-key');
    const result = resolveThirdPartySearchProvider(
      makeConfig({ thirdPartyProvider: 'exa', apiKey: 'settings-key' }),
    );

    expect(result.provider).toBeDefined();
    expect(ExaSearchProvider).toHaveBeenCalledWith('process-env-key');
  });
});

describe('formatThirdPartySearchResults', () => {
  it('should format results with index, url, date and highlights', () => {
    const formatted = formatThirdPartySearchResults([
      {
        title: 'First',
        url: 'https://first.example',
        publishedDate: '2026-03-01',
        highlights: [' point one ', 'point two'],
      },
      {
        title: 'Second',
        url: 'https://second.example',
        highlights: [],
      },
    ]);

    expect(formatted).toBe(
      [
        '[1] First (https://first.example)',
        '    Published: 2026-03-01',
        '    - point one',
        '    - point two',
        '',
        '[2] Second (https://second.example)',
      ].join('\n'),
    );
  });
});
