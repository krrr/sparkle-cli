/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook } from '../../test-utils/render.js';
import { act } from 'react';
import { describe, it, expect } from 'vitest';
import { useSettingsNavigation } from './useSettingsNavigation.js';

describe('useSettingsNavigation', () => {
  const mockItems = [
    { key: 'a' },
    { key: 'b' },
    { key: 'c' },
    { key: 'd' },
    { key: 'e' },
  ];

  it('should initialize with the first item active', async () => {
    const { result } = await renderHook(() =>
      useSettingsNavigation({ items: mockItems, maxItemsToShow: 3 }),
    );
    expect(result.current.activeIndex).toBe(0);
    expect(result.current.activeItemKey).toBe('a');
    expect(result.current.windowStart).toBe(0);
  });

  it('should move down correctly', async () => {
    const { result } = await renderHook(() =>
      useSettingsNavigation({ items: mockItems, maxItemsToShow: 3 }),
    );
    act(() => result.current.moveDown());
    expect(result.current.activeIndex).toBe(1);
    expect(result.current.activeItemKey).toBe('b');
  });

  it('should move up correctly', async () => {
    const { result } = await renderHook(() =>
      useSettingsNavigation({ items: mockItems, maxItemsToShow: 3 }),
    );
    act(() => result.current.moveDown()); // to index 1
    act(() => result.current.moveUp()); // back to 0
    expect(result.current.activeIndex).toBe(0);
  });

  it('should wrap around from top to bottom', async () => {
    const { result } = await renderHook(() =>
      useSettingsNavigation({ items: mockItems, maxItemsToShow: 3 }),
    );
    act(() => result.current.moveUp());
    expect(result.current.activeIndex).toBe(4);
    expect(result.current.activeItemKey).toBe('e');
  });

  it('should wrap around from bottom to top', async () => {
    const { result } = await renderHook(() =>
      useSettingsNavigation({ items: mockItems, maxItemsToShow: 3 }),
    );
    // Move to last item
    // Move to last item (index 4)
    act(() => result.current.moveDown()); // 1
    act(() => result.current.moveDown()); // 2
    act(() => result.current.moveDown()); // 3
    act(() => result.current.moveDown()); // 4
    expect(result.current.activeIndex).toBe(4);

    // Move down once more
    act(() => result.current.moveDown());
    expect(result.current.activeIndex).toBe(0);
  });

  it('should adjust scrollOffset when moving down past visible area', async () => {
    const { result } = await renderHook(() =>
      useSettingsNavigation({ items: mockItems, maxItemsToShow: 3 }),
    );

    act(() => result.current.moveDown()); // index 1
    act(() => result.current.moveDown()); // index 2, still offset 0
    expect(result.current.windowStart).toBe(0);

    act(() => result.current.moveDown()); // index 3, offset should be 1
    expect(result.current.windowStart).toBe(1);
  });

  it('should adjust scrollOffset when moving up past visible area', async () => {
    const { result } = await renderHook(() =>
      useSettingsNavigation({ items: mockItems, maxItemsToShow: 3 }),
    );

    act(() => result.current.moveDown()); // 1
    act(() => result.current.moveDown()); // 2
    act(() => result.current.moveDown()); // 3
    expect(result.current.windowStart).toBe(1);

    act(() => result.current.moveUp()); // index 2
    act(() => result.current.moveUp()); // index 1, offset should become 1
    act(() => result.current.moveUp()); // index 0, offset should become 0
    expect(result.current.windowStart).toBe(0);
  });

  it('should handle item preservation when list filters (Part 1 logic)', async () => {
    let items = mockItems;
    const { result, rerender } = await renderHook(
      ({ list }) => useSettingsNavigation({ items: list, maxItemsToShow: 3 }),
      { initialProps: { list: items } },
    );

    act(() => result.current.moveDown());
    act(() => result.current.moveDown()); // Item 'c'
    expect(result.current.activeItemKey).toBe('c');

    // Filter items but keep 'c'
    items = [mockItems[0], mockItems[2], mockItems[4]]; // 'a', 'c', 'e'
    rerender({ list: items });

    expect(result.current.activeItemKey).toBe('c');
    expect(result.current.activeIndex).toBe(1); // 'c' is now at index 1
  });

  describe('moveBy (paging)', () => {
    it('should move down by the given delta', async () => {
      const { result } = await renderHook(() =>
        useSettingsNavigation({ items: mockItems, maxItemsToShow: 2 }),
      );

      act(() => result.current.moveBy(2));
      expect(result.current.activeIndex).toBe(2);
      expect(result.current.activeItemKey).toBe('c');
      // Window slides so the active item stays visible
      expect(result.current.windowStart).toBe(1);
    });

    it('should move up by the given delta', async () => {
      const { result } = await renderHook(() =>
        useSettingsNavigation({ items: mockItems, maxItemsToShow: 2 }),
      );

      act(() => result.current.moveBy(4)); // to 'e'
      act(() => result.current.moveBy(-2)); // back to 'c'
      expect(result.current.activeIndex).toBe(2);
    });

    it('should clamp at the end of the list instead of wrapping', async () => {
      const { result } = await renderHook(() =>
        useSettingsNavigation({ items: mockItems, maxItemsToShow: 2 }),
      );

      act(() => result.current.moveBy(100));
      expect(result.current.activeIndex).toBe(4);
      expect(result.current.windowStart).toBe(3);
    });

    it('should clamp at the start of the list instead of wrapping', async () => {
      const { result } = await renderHook(() =>
        useSettingsNavigation({ items: mockItems, maxItemsToShow: 2 }),
      );

      act(() => result.current.moveBy(4)); // to 'e'
      act(() => result.current.moveBy(-100));
      expect(result.current.activeIndex).toBe(0);
      expect(result.current.windowStart).toBe(0);
    });
  });
});
