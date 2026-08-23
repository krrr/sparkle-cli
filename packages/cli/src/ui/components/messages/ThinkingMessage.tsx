/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { ThoughtSummary } from 'sparkle-cli-core';
import { theme } from '../../semantic-colors.js';
import { normalizeEscapedNewlines } from '../../utils/textUtils.js';
import type { InlineThinkingMode } from '../../utils/inlineThinkingMode.js';

interface ThinkingMessageProps {
  thought: ThoughtSummary;
  terminalWidth: number;
  isFirstThinking?: boolean;
  mode?: InlineThinkingMode;
}

const THINKING_LEFT_PADDING = 1;
/** Maximum rendered characters of the headline in compact mode. */
const COMPACT_HEADLINE_MAX_CHARS = 120;

interface NormalizedThought {
  lines: string[];
  /** True when a valid (non-noise) subject line exists and is `lines[0]`. */
  hasSubject: boolean;
}

function normalizeThoughtLines(thought: ThoughtSummary): NormalizedThought {
  const subject = normalizeEscapedNewlines(thought.subject).trim();
  const description = normalizeEscapedNewlines(thought.description);

  const isNoise = (text: string) => {
    const trimmed = text.trim();
    return !trimmed || /^\.+$/.test(trimmed);
  };

  const hasSubject = !!subject && !isNoise(subject);
  const lines: string[] = [];

  if (hasSubject) {
    lines.push(subject);
    if (description) {
      const descriptionLines = description
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => !isNoise(line));
      lines.push(...descriptionLines);
    }
  } else if (description.trim()) {
    // OpenAI path: OpenAI-compatible providers stream reasoning without a
    // wrapped subject line, so parseThought leaves the whole text in the
    // description. Those lines may rely on indentation and blank lines for
    // structure, so keep each line verbatim instead of trimming.
    lines.push(...description.split('\n'));
  }

  return { lines, hasSubject };
}

/**
 * Renders a model's thought as a distinct bubble.
 * Leverages Ink layout for wrapping and borders.
 *
 * In compact mode only a single headline line (plus a hidden-line count) is
 * rendered, keeping long chains of thought from flooding the scrollback.
 */
export const ThinkingMessage: React.FC<ThinkingMessageProps> = ({
  thought,
  terminalWidth,
  isFirstThinking,
  mode = 'full',
}) => {
  const { lines: fullLines, hasSubject } = useMemo(
    () => normalizeThoughtLines(thought),
    [thought],
  );

  if (fullLines.length === 0) {
    return null;
  }

  if (mode === 'compact') {
    const headline = fullLines[0].slice(0, COMPACT_HEADLINE_MAX_CHARS);
    const hiddenLines = fullLines.length - 1;
    return (
      <Box width={terminalWidth} flexDirection="column">
        {isFirstThinking && (
          <Text color={theme.text.primary} italic>
            {' '}
            Thought{' '}
          </Text>
        )}
        <Box
          marginLeft={THINKING_LEFT_PADDING}
          paddingLeft={1}
          width={Math.max(20, terminalWidth - THINKING_LEFT_PADDING - 2)}
          borderStyle="single"
          borderLeft={true}
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          borderColor={theme.text.secondary}
        >
          <Text color={theme.text.secondary} italic wrap="truncate-end">
            {headline}
            {hiddenLines > 0 ? ` (+${hiddenLines} lines)` : ''}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box width={terminalWidth} flexDirection="column">
      {isFirstThinking && (
        <Text color={theme.text.primary} italic>
          {' '}
          Thought{' '}
        </Text>
      )}

      <Box
        marginLeft={THINKING_LEFT_PADDING}
        paddingLeft={1}
        borderStyle="single"
        borderLeft={true}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor={theme.text.secondary}
        flexDirection="column"
      >
        <Text> </Text>
        {hasSubject && (
          <Text color={theme.text.primary} bold italic>
            {fullLines[0]}
          </Text>
        )}
        {(hasSubject ? fullLines.slice(1) : fullLines).map((line, index) => (
          <Text key={`body-line-${index}`} color={theme.text.secondary} italic>
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
};
