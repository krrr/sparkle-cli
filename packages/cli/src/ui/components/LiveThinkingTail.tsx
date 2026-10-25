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
  /** Maximum number of trailing lines to display. */
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
 * Renders the trailing lines of in-progress model reasoning below the loading
 * indicator, so reasoning can be observed in real time without flooding the
 * scrollback history.
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
      {lines.map((line, index) => (
        <Text
          key={`live-thinking-${index}`}
          color={theme.text.secondary}
          italic
          wrap="truncate-end"
        >
          {line}
        </Text>
      ))}
    </Box>
  );
};

export const LiveThinkingTail = React.memo(LiveThinkingTailBase);
