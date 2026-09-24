/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { computeIntraLineEmphasis } from './intraLineDiff.js';

describe('computeIntraLineEmphasis', () => {
  it('returns ranges covering only the changed word', () => {
    const result = computeIntraLineEmphasis('const oldVar = 1;', 'const newVar = 1;');
    expect(result).toBeDefined();
    // "oldVar" occupies offsets 6..12 in both lines.
    expect(result?.old).toEqual([{ start: 6, end: 12 }]);
    expect(result?.new).toEqual([{ start: 6, end: 12 }]);
  });

  it('returns undefined for identical lines', () => {
    expect(computeIntraLineEmphasis('same', 'same')).toBeUndefined();
  });

  it('returns undefined for empty inputs', () => {
    expect(computeIntraLineEmphasis('', 'new')).toBeUndefined();
    expect(computeIntraLineEmphasis('old', '')).toBeUndefined();
    expect(computeIntraLineEmphasis('', '')).toBeUndefined();
  });

  it('returns undefined for whole-line replacements (high change ratio)', () => {
    const result = computeIntraLineEmphasis(
      'const completelyUnrelatedA = 1;',
      'let entirelyDifferentB = 2;',
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when one line is deleted entirely (empty side)', () => {
    // Pairing only happens between del/add lines, but a defensive check: an
    // all-removed diff produces no "new" ranges.
    const result = computeIntraLineEmphasis('some text here', '');
    expect(result).toBeUndefined();
  });

  it('marks multiple changed words in one line', () => {
    const result = computeIntraLineEmphasis(
      "console.log('alpha', 'beta');",
      "console.log('ALPHA', 'beta');",
    );
    expect(result).toBeDefined();
    expect(result?.old.length).toBeGreaterThanOrEqual(1);
    expect(result?.new.length).toBeGreaterThanOrEqual(1);
    // The changed region must not span the whole line.
    const covered = result?.new.reduce((sum, r) => sum + (r.end - r.start), 0);
    expect(covered ?? 0).toBeLessThan("console.log('ALPHA', 'beta');".length);
  });

  it('covers appended words at end of line', () => {
    const result = computeIntraLineEmphasis(
      'const value = 1;',
      'const value = 1; // trailing',
    );
    expect(result).toBeDefined();
    expect(result?.old).toEqual([]);
    expect(result?.new).toEqual([{ start: 16, end: 28 }]);
  });

  it('marks both sides when a word is replaced by a longer one', () => {
    const result = computeIntraLineEmphasis('foo bar', 'foo baz');
    expect(result).toBeDefined();
    expect(result?.old).toEqual([{ start: 4, end: 7 }]);
    expect(result?.new).toEqual([{ start: 4, end: 7 }]);
  });

  it('skips very long lines to avoid pathological diff cost', () => {
    const longA = 'a'.repeat(600) + ' x';
    const longB = 'a'.repeat(600) + ' y';
    expect(computeIntraLineEmphasis(longA, longB)).toBeUndefined();
  });
});
