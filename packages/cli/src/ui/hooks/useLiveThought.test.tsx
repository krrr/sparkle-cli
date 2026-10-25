/**
 * @license
 * Copyright 2026 krrr
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../../test-utils/render.js';
import {
  useLiveThought,
  updateLiveThought,
  resetLiveThought,
  getLiveThoughtSnapshot,
  subscribeLiveThought,
} from './useLiveThought.js';

describe('useLiveThought', () => {
  beforeEach(() => {
    resetLiveThought();
  });

  it('initially returns null', async () => {
    const { result, unmount } = await renderHook(() => useLiveThought());
    expect(result.current).toBeNull();
    unmount();
  });

  it('updates when updateLiveThought is called', async () => {
    const { result, unmount } = await renderHook(() => useLiveThought());
    expect(result.current).toBeNull();

    await act(async () => {
      updateLiveThought('thinking step 1');
    });
    expect(result.current).toBe('thinking step 1');

    await act(async () => {
      updateLiveThought('thinking step 2');
    });
    expect(result.current).toBe('thinking step 2');

    await act(async () => {
      resetLiveThought();
    });
    expect(result.current).toBeNull();

    unmount();
  });

  it('does not notify listeners if the text does not change', () => {
    let callCount = 0;
    const unsubscribe = subscribeLiveThought(() => {
      callCount++;
    });

    updateLiveThought('same text');
    expect(callCount).toBe(1);

    updateLiveThought('same text');
    expect(callCount).toBe(1);

    unsubscribe();
  });

  it('returns current snapshot directly', () => {
    expect(getLiveThoughtSnapshot()).toBeNull();
    updateLiveThought('direct snapshot');
    expect(getLiveThoughtSnapshot()).toBe('direct snapshot');
    resetLiveThought();
    expect(getLiveThoughtSnapshot()).toBeNull();
  });
});
