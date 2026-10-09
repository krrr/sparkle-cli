/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../../test-utils/render.js';
import type React from 'react';
import { Box, type Text } from 'ink';
import {
  RadioButtonSelect,
  type RadioSelectItem,
  type RadioButtonSelectProps,
} from './RadioButtonSelect.js';
import {
  BaseSelectionList,
  type BaseSelectionListProps,
  type RenderItemContext,
} from './BaseSelectionList.js';

vi.mock('./BaseSelectionList.js', () => ({
  BaseSelectionList: vi.fn(() => null),
}));

vi.mock('../../semantic-colors.js', () => ({
  theme: {
    text: { secondary: 'COLOR_SECONDARY' },
    ui: { focus: 'COLOR_FOCUS' },
    background: { focus: 'COLOR_FOCUS_BG' },
  },
}));

const MockedBaseSelectionList = vi.mocked(BaseSelectionList) as unknown as ReturnType<
  typeof vi.fn
>;

type RadioRenderItemFn = (
  item: RadioSelectItem<string>,
  context: RenderItemContext,
) => React.JSX.Element;
const extractRenderItem = (): RadioRenderItemFn => {
  const mockCalls = MockedBaseSelectionList.mock.calls;

  if (mockCalls.length === 0) {
    throw new Error(
      'BaseSelectionList was not called. Ensure RadioButtonSelect is rendered before calling extractRenderItem.',
    );
  }

  const props = mockCalls[0][0] as BaseSelectionListProps<
    string,
    RadioSelectItem<string>
  >;

  if (typeof props.renderItem !== 'function') {
    throw new Error('renderItem prop was not found on BaseSelectionList call.');
  }

  return props.renderItem as RadioRenderItemFn;
};

describe('RadioButtonSelect', () => {
  const mockOnSelect = vi.fn();
  const mockOnHighlight = vi.fn();

  const ITEMS: Array<RadioSelectItem<string>> = [
    { label: 'Option 1', value: 'one', key: 'one' },
    { label: 'Option 2', value: 'two', key: 'two' },
    { label: 'Option 3', value: 'three', disabled: true, key: 'three' },
  ];

  const renderComponent = async (
    props: Partial<RadioButtonSelectProps<string>> = {},
  ) => {
    const defaultProps: RadioButtonSelectProps<string> = {
      items: ITEMS,
      onSelect: mockOnSelect,
      ...props,
    };
    return renderWithProviders(<RadioButtonSelect {...defaultProps} />);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Prop forwarding to BaseSelectionList', () => {
    it('should forward all props correctly when provided', async () => {
      const props = {
        items: ITEMS,
        initialIndex: 1,
        onSelect: mockOnSelect,
        onHighlight: mockOnHighlight,
        isFocused: false,
        showScrollArrows: true,
        maxItemsToShow: 5,
        showNumbers: false,
      };

      await renderComponent(props);

      expect(BaseSelectionList).toHaveBeenCalledTimes(1);
      expect(BaseSelectionList).toHaveBeenCalledWith(
        expect.objectContaining({
          ...props,
          renderItem: expect.any(Function),
        }),
        undefined,
      );
    });

    it('should use default props if not provided', async () => {
      await renderComponent({
        items: ITEMS,
        onSelect: mockOnSelect,
      });

      expect(BaseSelectionList).toHaveBeenCalledWith(
        expect.objectContaining({
          initialIndex: 0,
          isFocused: true,
          showScrollArrows: false,
          maxItemsToShow: 10,
          showNumbers: true,
        }),
        undefined,
      );
    });
  });

  describe('renderItem implementation', () => {
    let renderItem: RadioRenderItemFn;
    const mockContext: RenderItemContext = {
      isSelected: false,
      titleColor: 'MOCK_TITLE_COLOR',
      numberColor: 'MOCK_NUMBER_COLOR',
    };

    beforeEach(async () => {
      await renderComponent();
      renderItem = extractRenderItem();
    });

    it('should render the standard label display with correct color and truncation', () => {
      const item = ITEMS[0];

      const result = renderItem(item, mockContext);

      expect(result.type).toBe(Box);
      const props = result.props as { children: React.ReactNode };
      const textComponent = (props.children as React.ReactElement[])[0];
      const textProps = textComponent?.props as React.ComponentProps<typeof Text>;

      expect(textProps?.color).toBe(mockContext.titleColor);
      expect(textProps?.children).toBe('Option 1');
      expect(textProps?.wrap).toBe('truncate');
    });

    it('should render sublabel in secondary color when present', () => {
      const item: RadioSelectItem<string> = {
        label: 'Option with sub',
        sublabel: 'Secondary info',
        value: 'sub',
        key: 'sub',
      };

      const result = renderItem(item, mockContext);

      expect(result.type).toBe(Box);
      const props = result.props as { children: React.ReactNode };
      const textComponent = (props.children as React.ReactElement[])[0];
      const sublabelComponent = (props.children as React.ReactElement[])[1];
      const textProps = textComponent?.props as React.ComponentProps<typeof Text>;
      const sublabelProps = sublabelComponent?.props as React.ComponentProps<
        typeof Text
      >;

      expect(textProps?.children).toBe('Option with sub');
      expect(sublabelProps?.color).toBe('COLOR_SECONDARY');
      expect(sublabelProps?.children).toBe('Secondary info');
      expect(sublabelProps?.wrap).toBe('truncate');
    });
  });
});
