/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as Diff from 'diff';

/**
 * A half-open [start, end) character range within a single line's content.
 */
export interface EmphasisRange {
  start: number;
  end: number;
}

/**
 * Word-level change ranges for a paired delete/add line, indexed by side.
 */
export interface IntraLineEmphasis {
  old: EmphasisRange[];
  new: EmphasisRange[];
}

/** Pairs longer than this are skipped to avoid O(n*m) blowups during render. */
const MAX_LINE_LENGTH = 200;
/**
 * When more than this fraction of the shorter line's characters changed, the
 * lines are effectively unrelated; word-level highlighting would just paint
 * (almost) the whole line, so skip it (same heuristic VS Code applies).
 */
const MAX_CHANGE_RATIO = 0.75;
/** Ranges with a gap ≤ this value are merged at construction time. */
const MERGE_GAP = 3;

const pushRangeMerge = (
  ranges: EmphasisRange[],
  start: number,
  end: number,
) => {
  const last = ranges[ranges.length - 1];
  if (last && start - last.end <= MERGE_GAP) {
    last.end = Math.max(last.end, end);
  } else {
    ranges.push({ start, end });
  }
};

export const computeIntraLineEmphasis = (
  oldLine: string,
  newLine: string,
): IntraLineEmphasis | undefined => {
  if (
    !oldLine ||
    !newLine ||
    oldLine.length > MAX_LINE_LENGTH ||
    newLine.length > MAX_LINE_LENGTH ||
    oldLine === newLine
  ) {
    return undefined;
  }

  const parts = Diff.diffWordsWithSpace(oldLine, newLine);

  const oldRanges: EmphasisRange[] = [];
  const newRanges: EmphasisRange[] = [];
  let oldPos = 0;
  let newPos = 0;
  let removedChars = 0;
  let addedChars = 0;

  for (const part of parts) {
    const length = part.value.length;
    if (part.added) {
      pushRangeMerge(newRanges, newPos, newPos + length);
      newPos += length;
      addedChars += length;
    } else if (part.removed) {
      pushRangeMerge(oldRanges, oldPos, oldPos + length);
      oldPos += length;
      removedChars += length;
    } else {
      oldPos += length;
      newPos += length;
    }
  }

  // Measure change against the longer line using the larger of the two
  // change sides: a replaced word contributes its size once, not twice.
  const changedChars = Math.max(removedChars, addedChars);
  const longerLength = Math.max(oldLine.length, newLine.length);
  if (longerLength > 0 && changedChars / longerLength > MAX_CHANGE_RATIO) {
    return undefined;
  }

  // One side may legitimately be empty (pure append/delete within a paired
  // line); the other side's ranges still highlight the actual change.
  return { old: oldRanges, new: newRanges };
};
