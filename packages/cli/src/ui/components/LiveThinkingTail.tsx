/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import stripAnsi from 'strip-ansi';
import { useLiveThought } from '../hooks/useLiveThought.js';
import { theme } from '../semantic-colors.js';
import { normalizeEscapedNewlines } from '../utils/textUtils.js';

interface LiveThinkingTailProps {
  terminalWidth: number;
  /**
   * Maximum number of rendered rows of the tail to display. Rows, not lines:
   * a single long reasoning line can wrap across all of them.
   */
  maxLines?: number;
}

const DEFAULT_MAX_LINES = 3;
const NOISE_LINE = /^\.+$/;

/**
 * Splits accumulated reasoning into the tail lines to display: normalizes
 * escaped newlines, strips ANSI escapes, drops blank/noise lines, and keeps
 * leading indentation verbatim (OpenAI-path reasoning relies on it for
 * structure) while trimming only trailing whitespace.
 */
export function getLiveThinkingTailLines(
  text: string | null,
  maxLines: number = DEFAULT_MAX_LINES,
): string[] {
  if (!text) {
    return [];
  }
  return normalizeEscapedNewlines(stripAnsi(text))
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !NOISE_LINE.test(line))
    .slice(-maxLines);
}

/**
 * Renders the trailing rows of in-progress model reasoning below the loading
 * indicator, so reasoning can be observed in real time without flooding the
 * scrollback history.
 *
 * Lines wrap instead of being truncated so an unbroken run of reasoning stays
 * readable, and the box keeps showing the most recent rows: reasoning often
 * streams for thousands of characters before the model emits a newline.
 *
 * The tail is pinned to the bottom with a scroll region rather than by
 * measuring the content and offsetting it. Ink resolves a scroll region's
 * height during the layout pass that renders the frame, so the clamp is always
 * consistent with the content being drawn. Measuring instead (as MaxSizedBox
 * does, via ResizeObserver) lags one frame behind, and the sliding window of
 * reasoning lines changes the measured height often enough that the stale
 * offset can push the whole tail out of its clip for a single frame.
 *
 * Subscribes to the live thought store directly so that only this leaf
 * re-renders as reasoning deltas arrive.
 */
const LiveThinkingTailBase: React.FC<LiveThinkingTailProps> = ({
  terminalWidth,
  maxLines = DEFAULT_MAX_LINES,
}) => {
  const text = useLiveThought();
  const lines = useMemo(
    () => getLiveThinkingTailLines(text, maxLines),
    [text, maxLines],
  );

  if (lines.length === 0) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      width={Math.max(20, terminalWidth - 2)}
      marginLeft={1}
      paddingLeft={1}
      borderStyle="single"
      borderLeft={true}
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderColor={theme.text.secondary}
    >
      {/* Pinning to the bottom keeps the newest reasoning visible.
          Don't use MaxSizedBox. */}
      <Box
        flexDirection="column"
        maxHeight={maxLines}
        overflowY="scroll"
        overflowX="hidden"
        scrollbar={false}
        scrollTop={Number.MAX_SAFE_INTEGER}
      >
        <Box flexDirection="column" flexShrink={0}>
          {lines.map((line, index) => (
            <Text
              key={`live-thinking-${index}`}
              color={theme.text.secondary}
              italic
              wrap="wrap"
            >
              {line}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

export const LiveThinkingTail = React.memo(LiveThinkingTailBase);
