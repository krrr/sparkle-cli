/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo } from 'react';
import { Box, Text } from 'ink';
import stripAnsi from 'strip-ansi';
import { theme } from '../semantic-colors.js';
import { normalizeEscapedNewlines } from '../utils/textUtils.js';

interface LiveThinkingTailProps {
  /** Reasoning text accumulated so far in the current reasoning block. */
  text: string | null;
  terminalWidth: number;
  /** Maximum number of trailing lines to display. */
  maxLines?: number;
}

const DEFAULT_MAX_LINES = 3;
const NOISE_LINE = /^\.+$/;

/**
 * Renders the trailing lines of in-progress model reasoning below the loading
 * indicator, so reasoning can be observed in real time without flooding the
 * scrollback history.
 */
export const LiveThinkingTail: React.FC<LiveThinkingTailProps> = ({
  text,
  terminalWidth,
  maxLines = DEFAULT_MAX_LINES,
}) => {
  const lines = useMemo(() => {
    if (!text) {
      return [];
    }
    const normalized = normalizeEscapedNewlines(stripAnsi(text));
    return normalized
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !NOISE_LINE.test(line))
      .slice(-maxLines);
  }, [text, maxLines]);

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
