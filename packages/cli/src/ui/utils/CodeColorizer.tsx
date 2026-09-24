/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import { common, createLowlight } from 'lowlight';
import type {
  Root,
  Element,
  Text as HastText,
  ElementContent,
  RootContent,
} from 'hast';
import stripAnsi from 'strip-ansi';
import { themeManager } from '../themes/theme-manager.js';
import type { Theme } from '../themes/theme.js';
import type { EmphasisRange } from './intraLineDiff.js';
import { MaxSizedBox, MINIMUM_MAX_HEIGHT } from '../components/shared/MaxSizedBox.js';
import { debugLogger } from 'sparkle-cli-core';
import type { LoadedSettings } from '../../config/settings.js';

// Configure theming and parsing utilities lazily.
let lowlightInstance: ReturnType<typeof createLowlight> | null = null;
function getLowlight(): ReturnType<typeof createLowlight> {
  if (!lowlightInstance) {
    lowlightInstance = createLowlight(common);
  }
  return lowlightInstance;
}

interface RenderHastOptions {
  theme: Theme;
  inheritedColor: string | undefined;
  /**
   * Character ranges (relative to the highlighted line's full text) that
   * should render with an emphasis background color. Text node offsets are
   * tracked across the traversal so ranges align with the final output.
   */
  emphasis?: {
    ranges: EmphasisRange[];
    backgroundColor: string;
    offsetRef: { current: number };
  };
}

function renderHastNode(
  node: Root | Element | HastText | RootContent,
  options: RenderHastOptions,
): React.ReactNode {
  const { theme, inheritedColor, emphasis } = options;

  if (node.type === 'text') {
    // Use the color passed down from parent element, or the theme's default.
    const color = inheritedColor || theme.defaultColor;
    if (emphasis && emphasis.ranges.length > 0) {
      return renderTextWithEmphasis(node.value, color, emphasis);
    }
    return <Text color={color}>{node.value}</Text>;
  }

  // Handle Element Nodes: Determine color and pass it down, don't wrap
  if (node.type === 'element') {
    const nodeClasses: string[] =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (node.properties?.['className'] as string[]) || [];
    let elementColor: string | undefined = undefined;

    // Find color defined specifically for this element's class
    for (let i = nodeClasses.length - 1; i >= 0; i--) {
      const color = theme.getInkColor(nodeClasses[i]);
      if (color) {
        elementColor = color;
        break;
      }
    }

    // Determine the color to pass down: Use this element's specific color
    // if found; otherwise, continue passing down the already inherited color.
    const childOptions: RenderHastOptions = {
      ...options,
      inheritedColor: elementColor || inheritedColor,
    };

    // Recursively render children, passing the determined color down
    // Ensure child type matches expected HAST structure (ElementContent is common)
    const children = node.children?.map((child: ElementContent, index: number) => (
      <React.Fragment key={index}>{renderHastNode(child, childOptions)}</React.Fragment>
    ));

    // Element nodes now only group children; color is applied by Text nodes.
    // Use a React Fragment to avoid adding unnecessary elements.
    return <React.Fragment>{children}</React.Fragment>;
  }

  // Handle Root Node: Start recursion with initially inherited color
  if (node.type === 'root') {
    // Check if children array is empty - this happens when lowlight can't detect language – fall back to plain text
    if (!node.children || node.children.length === 0) {
      return null;
    }

    // Pass down the initial inheritedColor (likely undefined from the top call)
    // Ensure child type matches expected HAST structure (RootContent is common)
    return node.children?.map((child: RootContent, index: number) => (
      <React.Fragment key={index}>{renderHastNode(child, options)}</React.Fragment>
    ));
  }

  // Handle unknown or unsupported node types
  return null;
}

/**
 * Splits a HAST text node's value at emphasis range boundaries, rendering the
 * covered substrings with the emphasis background while preserving syntax
 * highlighting colors on every fragment.
 */
function renderTextWithEmphasis(
  value: string,
  color: string,
  emphasis: NonNullable<RenderHastOptions['emphasis']>,
): React.ReactNode {
  const nodeStart = emphasis.offsetRef.current;
  const nodeEnd = nodeStart + value.length;
  emphasis.offsetRef.current = nodeEnd;

  // Find ranges overlapping this text node and convert to node-local offsets.
  const localRanges: EmphasisRange[] = [];
  for (const range of emphasis.ranges) {
    const start = Math.max(range.start, nodeStart);
    const end = Math.min(range.end, nodeEnd);
    if (start < end) {
      localRanges.push({ start: start - nodeStart, end: end - nodeStart });
    }
  }
  if (localRanges.length === 0) {
    return <Text color={color}>{value}</Text>;
  }

  const fragments: React.ReactNode[] = [];
  let cursor = 0;
  for (const range of localRanges) {
    if (cursor < range.start) {
      fragments.push(
        <Text key={`plain-${cursor}`} color={color}>
          {value.slice(cursor, range.start)}
        </Text>,
      );
    }
    fragments.push(
      <Text
        key={`emphasis-${range.start}`}
        color={color}
        backgroundColor={emphasis.backgroundColor}
      >
        {value.slice(range.start, range.end)}
      </Text>,
    );
    cursor = range.end;
  }
  if (cursor < value.length) {
    fragments.push(
      <Text key={`plain-${cursor}`} color={color}>
        {value.slice(cursor)}
      </Text>,
    );
  }
  return fragments;
}

function highlightAndRenderLine(
  line: string,
  language: string | null,
  theme: Theme,
  emphasis?: {
    ranges: EmphasisRange[];
    backgroundColor: string;
  },
): React.ReactNode {
  try {
    const strippedLine = stripAnsi(line);
    const lowlight = getLowlight();
    const highlighted =
      !language || !lowlight.registered(language)
        ? lowlight.highlightAuto(strippedLine)
        : lowlight.highlight(language, strippedLine);

    const options: RenderHastOptions = {
      theme,
      inheritedColor: undefined,
      emphasis: undefined,
    };
    if (emphasis) {
      // Emphasis ranges refer to offsets in the stripped line, matching the
      // text lowlight highlights, so offset tracking starts from zero.
      options.emphasis = {
        ranges: emphasis.ranges,
        backgroundColor: emphasis.backgroundColor,
        offsetRef: { current: 0 },
      };
    }
    const renderedNode = renderHastNode(highlighted, options);
    return renderedNode !== null ? renderedNode : strippedLine;
  } catch {
    return stripAnsi(line);
  }
}

export function colorizeLine(
  line: string,
  language: string | null,
  theme?: Theme,
  disableColor = false,
): React.ReactNode {
  if (disableColor) {
    return <Text>{line}</Text>;
  }
  const activeTheme = theme || themeManager.getActiveTheme();
  return highlightAndRenderLine(line, language, activeTheme);
}

/**
 * Like colorizeLine, but renders the given character ranges with an emphasis
 * background color (VS Code-style word-level diff highlighting) while
 * preserving syntax highlighting. Falls back to colorizeLine when there are
 * no ranges or colors are disabled.
 */
export function colorizeLineWithEmphasis(
  line: string,
  language: string | null,
  emphasisRanges: EmphasisRange[],
  emphasisBackgroundColor: string,
  theme?: Theme,
  disableColor = false,
): React.ReactNode {
  if (disableColor || emphasisRanges.length === 0) {
    return colorizeLine(line, language, theme, disableColor);
  }
  const activeTheme = theme || themeManager.getActiveTheme();
  return highlightAndRenderLine(line, language, activeTheme, {
    ranges: emphasisRanges,
    backgroundColor: emphasisBackgroundColor,
  });
}

export interface ColorizeCodeOptions {
  code: string;
  language?: string | null;
  availableHeight?: number;
  maxWidth: number;
  theme?: Theme | null;
  settings: LoadedSettings;
  hideLineNumbers?: boolean;
  disableColor?: boolean;
  returnLines?: boolean;
  paddingX?: number;
}

/**
 * Renders syntax-highlighted code for Ink applications using a selected theme.
 *
 * @param options The options for colorizing the code.
 * @returns A React.ReactNode containing Ink <Text> elements for the highlighted code.
 */
export function colorizeCode(
  options: ColorizeCodeOptions & { returnLines: true },
): React.ReactNode[];
export function colorizeCode(
  options: ColorizeCodeOptions & { returnLines?: false },
): React.ReactNode;
export function colorizeCode({
  code,
  language = null,
  availableHeight,
  maxWidth,
  theme = null,
  settings,
  hideLineNumbers = false,
  disableColor = false,
  returnLines = false,
  paddingX = 0,
}: ColorizeCodeOptions): React.ReactNode | React.ReactNode[] {
  const codeToHighlight = code.replace(/\n$/, '');
  const activeTheme = theme || themeManager.getActiveTheme();
  const showLineNumbers = hideLineNumbers ? false : settings.merged.ui.showLineNumbers;

  // We force MaxSizedBox if availableHeight is provided, even if alternate buffer is enabled,
  // because this might be rendered in a constrained UI box (like tool confirmation).
  const useMaxSizedBox =
    (!settings.merged.ui.useAlternateBuffer || availableHeight !== undefined) &&
    !returnLines;

  let hiddenLinesCount = 0;
  let finalLines = codeToHighlight.split(/\r?\n/);

  try {
    // Optimization to avoid highlighting lines that cannot possibly be displayed.
    if (availableHeight !== undefined && useMaxSizedBox) {
      availableHeight = Math.max(availableHeight, MINIMUM_MAX_HEIGHT);
      if (finalLines.length > availableHeight) {
        const sliceIndex = finalLines.length - availableHeight;
        hiddenLinesCount = sliceIndex;
        finalLines = finalLines.slice(sliceIndex);
      }
    }

    const padWidth = String(finalLines.length + hiddenLinesCount).length;

    const renderedLines = finalLines.map((line, index) => {
      const contentToRender = disableColor
        ? line
        : highlightAndRenderLine(line, language, activeTheme);

      return (
        <Box key={index} minHeight={1}>
          {showLineNumbers && (
            <Box
              minWidth={padWidth + 1}
              flexShrink={0}
              paddingRight={1}
              alignItems="flex-start"
              justifyContent="flex-end"
            >
              <Text color={disableColor ? undefined : activeTheme.colors.Gray}>
                {`${index + 1 + hiddenLinesCount}`}
              </Text>
            </Box>
          )}
          <Text color={disableColor ? undefined : activeTheme.defaultColor} wrap="wrap">
            {contentToRender}
          </Text>
        </Box>
      );
    });

    if (returnLines) {
      return renderedLines;
    }

    if (useMaxSizedBox) {
      return (
        <MaxSizedBox
          paddingX={paddingX}
          maxHeight={availableHeight}
          maxWidth={maxWidth}
          additionalHiddenLinesCount={hiddenLinesCount}
          overflowDirection="top"
        >
          {renderedLines}
        </MaxSizedBox>
      );
    }

    return (
      <Box flexDirection="column" width={maxWidth}>
        {renderedLines}
      </Box>
    );
  } catch (error) {
    debugLogger.warn(
      `[colorizeCode] Error highlighting code for language "${language}":`,
      error,
    );
    // Fall back to plain text with default color on error
    const padWidth = String(finalLines.length + hiddenLinesCount).length;
    const fallbackLines = finalLines.map((line, index) => (
      <Box key={index} minHeight={1}>
        {showLineNumbers && (
          <Box
            minWidth={padWidth + 1}
            flexShrink={0}
            paddingRight={1}
            alignItems="flex-start"
            justifyContent="flex-end"
          >
            <Text color={disableColor ? undefined : activeTheme.defaultColor}>
              {`${index + 1 + hiddenLinesCount}`}
            </Text>
          </Box>
        )}
        <Text color={disableColor ? undefined : activeTheme.colors.Gray}>
          {stripAnsi(line)}
        </Text>
      </Box>
    ));

    if (returnLines) {
      return fallbackLines;
    }

    if (useMaxSizedBox) {
      return (
        <MaxSizedBox
          paddingX={paddingX}
          maxHeight={availableHeight}
          maxWidth={maxWidth}
          additionalHiddenLinesCount={hiddenLinesCount}
          overflowDirection="top"
        >
          {fallbackLines}
        </MaxSizedBox>
      );
    }

    return (
      <Box flexDirection="column" width={maxWidth}>
        {fallbackLines}
      </Box>
    );
  }
}
