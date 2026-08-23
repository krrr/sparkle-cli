/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ExaSearchProvider } from './exa-search.js';
import { fetchWithTimeout } from '../../utils/fetch.js';
import { retryWithBackoff } from '../../utils/retry.js';

vi.mock('../../utils/fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/fetch.js')>();
  return { ...actual, fetchWithTimeout: vi.fn() };
});

vi.mock('../../utils/retry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/retry.js')>();
  return {
    ...actual,
    retryWithBackoff: vi.fn(<T>(fn: () => Promise<T>) => fn()),
  };
});

function mockOkResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  };
}

describe('ExaSearchProvider', () => {
  let provider: ExaSearchProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new ExaSearchProvider('test-api-key');
  });

  it('should send the query to the Exa search endpoint with highlights', async () => {
    (fetchWithTimeout as Mock).mockResolvedValue(
      mockOkResponse({ requestId: 'req', results: [] }),
    );

    await provider.search('test query');

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    const [url, timeout, options] = (fetchWithTimeout as Mock).mock.calls[0];
    expect(url).toBe('https://api.exa.ai/search');
    expect(timeout).toBe(30_000);
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-api-key',
    });
    expect(JSON.parse(options.body)).toEqual({
      query: 'test query',
      numResults: 10,
      contents: { highlights: true, maxAgeHours: 24 },
    });
  });

  it('should delegate through retryWithBackoff with the abort signal', async () => {
    const signal = new AbortController().signal;
    (fetchWithTimeout as Mock).mockResolvedValue(
      mockOkResponse({ results: [] }),
    );

    await provider.search('test query', signal);

    expect(retryWithBackoff).toHaveBeenCalledWith(expect.any(Function), {
      signal,
    });
  });

  it('should map results and default missing optional fields', async () => {
    (fetchWithTimeout as Mock).mockResolvedValue(
      mockOkResponse({
        results: [
          {
            title: 'Titled Result',
            url: 'https://example.com/titled',
            publishedDate: '2026-02-01',
            highlights: ['highlight a'],
          },
          {
            url: 'https://example.com/untitled',
          },
        ],
      }),
    );

    const results = await provider.search('test query');

    expect(results).toEqual([
      {
        title: 'Titled Result',
        url: 'https://example.com/titled',
        publishedDate: '2026-02-01',
        highlights: ['highlight a'],
      },
      {
        title: 'https://example.com/untitled',
        url: 'https://example.com/untitled',
        publishedDate: undefined,
        highlights: [],
      },
    ]);
  });

  it('should filter out results without a url', async () => {
    (fetchWithTimeout as Mock).mockResolvedValue(
      mockOkResponse({
        results: [{ title: 'No URL' }, { url: 'https://example.com' }],
      }),
    );

    const results = await provider.search('test query');

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe('https://example.com');
  });

  it('should throw an error carrying the HTTP status for non-ok responses', async () => {
    (fetchWithTimeout as Mock).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    await expect(provider.search('test query')).rejects.toMatchObject({
      message: expect.stringContaining('401'),
      status: 401,
    });
  });
});
