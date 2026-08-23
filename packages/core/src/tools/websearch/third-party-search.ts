/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../../config/config.js';
import { ExaSearchProvider } from './exa-search.js';

/**
 * A single search result from a third-party search API.
 */
export interface ThirdPartySearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  /** Short key excerpts from the page (Exa highlights). */
  highlights: string[];
}

/**
 * A third-party web search provider. Used by the web search tool when the
 * active provider does not support Google Search grounding.
 */
export interface ThirdPartySearchProvider {
  readonly name: string;
  search(
    query: string,
    signal?: AbortSignal,
  ): Promise<ThirdPartySearchResult[]>;
}

type ProviderFactory = (apiKey: string) => ThirdPartySearchProvider;

// Registry for provider support. To add a provider: implement
// ThirdPartySearchProvider, register a factory here plus its optional API key
// env var, and add the enum value in the CLI settings schema.
const PROVIDER_FACTORIES: Record<string, ProviderFactory> = {
  exa: (apiKey) => new ExaSearchProvider(apiKey),
};

// Env vars that override the settings-file API key per provider.
const API_KEY_ENV_VARS: Record<string, string> = {
  exa: 'EXA_API_KEY',
};

/**
 * Formats third-party search results as markdown for tool output.
 */
export function formatThirdPartySearchResults(
  results: ThirdPartySearchResult[],
): string {
  return results
    .map((result, index) => {
      const lines = [`[${index + 1}] ${result.title} (${result.url})`];
      if (result.publishedDate) {
        lines.push(`    Published: ${result.publishedDate}`);
      }
      for (const highlight of result.highlights) {
        lines.push(`    - ${highlight.trim()}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * Resolves the configured third-party search provider.
 * API keys resolve with env-var precedence over the settings value.
 */
export function resolveThirdPartySearchProvider(config: Config):
  | { provider: ThirdPartySearchProvider; reason?: undefined }
  | {
      provider?: undefined;
      reason: string;
    } {
  const webSearchConfig = config.getWebSearchConfig();
  const providerId = webSearchConfig?.thirdPartyProvider;

  if (!providerId) {
    return {
      reason:
        'No third-party search provider configured. Set tools.webSearch.thirdPartyProvider (e.g. "exa") and tools.webSearch.apiKey in settings.json.',
    };
  }

  const factory = PROVIDER_FACTORIES[providerId];
  if (!factory) {
    return {
      reason: `Unknown third-party search provider "${providerId}". Supported providers: ${Object.keys(PROVIDER_FACTORIES).join(', ')}.`,
    };
  }

  const envVar = API_KEY_ENV_VARS[providerId];
  const apiKey =
    config.env?.[envVar] ?? process.env[envVar] ?? webSearchConfig?.apiKey;
  if (!apiKey) {
    return {
      reason: `Third-party search provider "${providerId}" is selected but no API key is configured. Set tools.webSearch.apiKey in settings.json or the ${envVar} environment variable.`,
    };
  }

  return { provider: factory(apiKey) };
}
