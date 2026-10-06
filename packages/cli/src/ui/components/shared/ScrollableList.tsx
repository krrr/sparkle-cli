/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, forwardRef, useImperativeHandle, useCallback, useMemo } from 'react';
import type React from 'react';
import {
  VirtualizedList,
  type VirtualizedListRef,
  type VirtualizedListProps,
  SCROLL_TO_ITEM_END,
} from './VirtualizedList.js';
import { useScrollable } from '../../contexts/ScrollProvider.js';
import { Box, type DOMElement } from 'ink';
import { useKeypress, type Key } from '../../hooks/useKeypress.js';
import { Command } from '../../key/keyMatchers.js';
import { useKeyMatchers } from '../../hooks/useKeyMatchers.js';

interface ScrollableListProps<T> extends VirtualizedListProps<T> {
  hasFocus: boolean;
  width?: string | number;
  scrollbar?: boolean;
  stableScrollback?: boolean;
  copyModeEnabled?: boolean;
  isStatic?: boolean;
  fixedItemHeight?: boolean;
  targetScrollIndex?: number;
  containerHeight?: number;
  scrollbarThumbColor?: string;
}

export type ScrollableListRef<T> = VirtualizedListRef<T>;

function ScrollableList<T>(
  props: ScrollableListProps<T>,
  ref: React.Ref<ScrollableListRef<T>>,
) {
  const keyMatchers = useKeyMatchers();
  const { hasFocus, width, scrollbar = true, stableScrollback } = props;
  const virtualizedListRef = useRef<VirtualizedListRef<T>>(null);
  const containerRef = useRef<DOMElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      scrollBy: (delta) => virtualizedListRef.current?.scrollBy(delta),
      scrollTo: (offset) => virtualizedListRef.current?.scrollTo(offset),
      scrollToEnd: () => virtualizedListRef.current?.scrollToEnd(),
      scrollToIndex: (params) => virtualizedListRef.current?.scrollToIndex(params),
      scrollToItem: (params) => virtualizedListRef.current?.scrollToItem(params),
      getScrollIndex: () => virtualizedListRef.current?.getScrollIndex() ?? 0,
      getScrollState: () =>
        virtualizedListRef.current?.getScrollState() ?? {
          scrollTop: 0,
          scrollHeight: 0,
          innerHeight: 0,
        },
    }),
    [],
  );

  const getScrollState = useCallback(
    () =>
      virtualizedListRef.current?.getScrollState() ?? {
        scrollTop: 0,
        scrollHeight: 0,
        innerHeight: 0,
      },
    [],
  );

  const scrollBy = useCallback((delta: number) => {
    virtualizedListRef.current?.scrollBy(delta);
  }, []);
  const scrollTo = useCallback((targetScrollTop: number) => {
    virtualizedListRef.current?.scrollTo(targetScrollTop);
  }, []);

  useKeypress(
    (key: Key) => {
      if (keyMatchers[Command.SCROLL_UP](key)) {
        scrollBy(-1);
        return true;
      } else if (keyMatchers[Command.SCROLL_DOWN](key)) {
        scrollBy(1);
        return true;
      } else if (
        keyMatchers[Command.PAGE_UP](key) ||
        keyMatchers[Command.PAGE_DOWN](key)
      ) {
        const direction = keyMatchers[Command.PAGE_UP](key) ? -1 : 1;
        const scrollState = getScrollState();
        scrollBy(direction * scrollState.innerHeight);
        return true;
      } else if (keyMatchers[Command.SCROLL_HOME](key)) {
        scrollTo(0);
        return true;
      } else if (keyMatchers[Command.SCROLL_END](key)) {
        scrollTo(SCROLL_TO_ITEM_END);
        return true;
      }
      return false;
    },
    { isActive: hasFocus },
  );

  const hasFocusCallback = useCallback(() => hasFocus, [hasFocus]);

  const scrollableEntry = useMemo(
    () => ({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      ref: containerRef as React.RefObject<DOMElement>,
      getScrollState,
      scrollBy,
      scrollTo,
      hasFocus: hasFocusCallback,
    }),
    [getScrollState, hasFocusCallback, scrollBy, scrollTo],
  );

  useScrollable(scrollableEntry, true);

  return (
    <Box ref={containerRef} flexGrow={1} flexDirection="column" width={width}>
      <VirtualizedList
        ref={virtualizedListRef}
        {...props}
        scrollbar={scrollbar}
        stableScrollback={stableScrollback}
      />
    </Box>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
const ScrollableListWithForwardRef = forwardRef(ScrollableList) as <T>(
  props: ScrollableListProps<T> & { ref?: React.Ref<ScrollableListRef<T>> },
) => React.ReactElement;

export { ScrollableListWithForwardRef as ScrollableList };
