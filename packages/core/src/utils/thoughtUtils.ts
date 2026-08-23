/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type ThoughtSummary = {
  subject: string;
  description: string;
};

/**
 * A live (in-progress) reasoning update streamed while a reasoning block is
 * still being generated.
 */
export type ThoughtDeltaSummary = {
  /** Reasoning text accumulated so far in the current reasoning block. */
  text: string;
};

const START_DELIMITER = '**';
const END_DELIMITER = '**';

/**
 * Parses a raw thought string into a structured ThoughtSummary object.
 *
 * A subject is recognized only when the entire first line is wrapped in
 * double asterisks (e.g., `**Subject**`), the format the Gemini API uses
 * for its thoughts. Other occurrences of double asterisks (inline bold,
 * markdown fragments, as commonly produced by OpenAI-compatible providers'
 * plain reasoning text) are left untouched: the subject stays empty and the
 * whole text is treated as the description.
 *
 * @param rawText The raw text of the thought.
 * @returns A ThoughtSummary object. If no valid subject is found, the entire
 * string is treated as the description.
 */
export function parseThought(rawText: string): ThoughtSummary {
  const normalized = rawText.trim().replaceAll('\r', '');
  const newlineIndex = normalized.indexOf('\n');
  const firstLine = (
    newlineIndex === -1 ? normalized : normalized.slice(0, newlineIndex)
  ).trim();

  if (
    !firstLine.startsWith(START_DELIMITER) ||
    !firstLine.endsWith(END_DELIMITER)
  ) {
    // The first line is not a fully wrapped subject; keep the whole text as
    // the description rather than guessing at inline bold fragments.
    return { subject: '', description: normalized };
  }

  const inner = firstLine.slice(
    START_DELIMITER.length,
    firstLine.length - END_DELIMITER.length,
  );
  // A line like "**First** some text **Second**" spans several bold fragments;
  // that is not a wrapped subject line.
  if (inner.includes(START_DELIMITER)) {
    return { subject: '', description: normalized };
  }

  const subject = inner.trim();
  const description =
    newlineIndex === -1 ? '' : normalized.slice(newlineIndex + 1).trim();

  return { subject, description };
}
