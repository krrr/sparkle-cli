/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import type { ProviderProfileService } from 'sparkle-cli-core';
import { renderHook } from '../../test-utils/render.js';
import { useProfileModelActions } from './useProfileModelActions.js';

describe('useProfileModelActions', () => {
  const mockService = {
    addModel: vi.fn(),
    updateModel: vi.fn(),
    removeModel: vi.fn(),
    setDefaultModel: vi.fn(),
  };
  const profileService = mockService as unknown as ProviderProfileService;

  beforeEach(() => {
    vi.resetAllMocks();
    for (const fn of Object.values(mockService)) {
      fn.mockResolvedValue(undefined);
    }
  });

  it('delegates operations to the profile service with the profile id', async () => {
    const onChanged = vi.fn();
    const { result } = await renderHook(() =>
      useProfileModelActions(profileService, 'p1', onChanged),
    );

    await act(async () => {
      await result.current.addModel({ id: 'm1' });
    });
    expect(mockService.addModel).toHaveBeenCalledWith('p1', { id: 'm1' });

    await act(async () => {
      await result.current.updateModel('m1', { id: 'm1', tier: 'pro' });
    });
    expect(mockService.updateModel).toHaveBeenCalledWith('p1', 'm1', {
      id: 'm1',
      tier: 'pro',
    });

    await act(async () => {
      await result.current.deleteModel('m1');
    });
    expect(mockService.removeModel).toHaveBeenCalledWith('p1', 'm1');

    await act(async () => {
      await result.current.setDefaultModel('m1');
    });
    expect(mockService.setDefaultModel).toHaveBeenCalledWith('p1', 'm1');

    expect(onChanged).toHaveBeenCalledTimes(4);
    expect(result.current.error).toBeNull();
  });

  it('captures service errors and skips the refresh callback', async () => {
    mockService.addModel.mockRejectedValue(new Error('boom'));
    const onChanged = vi.fn();
    const { result } = await renderHook(() =>
      useProfileModelActions(profileService, 'p1', onChanged),
    );

    await act(async () => {
      await result.current.addModel({ id: 'm1' });
    });

    expect(result.current.error).toBe('boom');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('clears a previous error when the next operation starts', async () => {
    mockService.addModel.mockRejectedValueOnce(new Error('boom'));
    const { result } = await renderHook(() =>
      useProfileModelActions(profileService, 'p1'),
    );

    await act(async () => {
      await result.current.addModel({ id: 'm1' });
    });
    expect(result.current.error).toBe('boom');

    await act(async () => {
      await result.current.addModel({ id: 'm2' });
    });
    expect(result.current.error).toBeNull();
  });

  it('is a no-op without a service or profile id', async () => {
    const { result } = await renderHook(() =>
      useProfileModelActions(undefined, undefined),
    );

    await act(async () => {
      await result.current.addModel({ id: 'm1' });
      await result.current.deleteModel('m1');
    });

    expect(mockService.addModel).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});
