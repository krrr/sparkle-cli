/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { fetchWithTimeout } from '../../utils/fetch.js';
import { retryWithBackoff } from '../../utils/retry.js';
import type {
  ThirdPartySearchProvider,
  ThirdPartySearchResult,
} from './third-party-search.js';

const EXA_SEARCH_ENDPOINT = 'https://api.exa.ai/search';
const EXA_REQUEST_TIMEOUT_MS = 30_000;
const EXA_NUM_RESULTS = 10;

interface ErrorWithStatus extends Error {
  status?: number;
}

interface ExaSearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    publishedDate?: string;
    highlights?: string[];
  }>;
}

/**
 * Exa search API implementation (https://docs.exa.ai).
 * Requests highlights rather than full page text, which is Exa's recommended
 * (and much cheaper) result shape for coding agents.
 */
export class ExaSearchProvider implements ThirdPartySearchProvider {
  readonly name = 'exa';

  constructor(private readonly apiKey: string) {}

  async search(
    query: string,
    signal?: AbortSignal,
  ): Promise<ThirdPartySearchResult[]> {
    const response = await retryWithBackoff(
      async () => {
        const res = await fetchWithTimeout(
          EXA_SEARCH_ENDPOINT,
          EXA_REQUEST_TIMEOUT_MS,
          {
            signal,
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              query,
              numResults: EXA_NUM_RESULTS,
              contents: { highlights: true, maxAgeHours: 24 },
            }),
          },
        );
        if (!res.ok) {
          const error = new Error(
            `Exa search request failed with status ${res.status} ${res.statusText}`,
          );
          (error as ErrorWithStatus).status = res.status;
          throw error;
        }
        return res;
      },
      { signal },
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const data = (await response.json()) as ExaSearchResponse;
    return (data.results ?? []).flatMap((result) =>
      result.url
        ? [
            {
              title: result.title ?? result.url,
              url: result.url,
              publishedDate: result.publishedDate,
              highlights: result.highlights ?? [],
            },
          ]
        : [],
    );
  }
}
