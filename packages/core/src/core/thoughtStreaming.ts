/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Part } from '@google/genai';

/**
 * Marker protocol for live (in-progress) reasoning updates.
 *
 * While a reasoning block is still streaming, the OpenAI chunk converter
 * emits partial thought parts so the UI can display reasoning in real time
 * instead of waiting for the whole block. Partial parts carry the reasoning
 * text accumulated so far in the current block. They are transient: the
 * consolidated thought part for the block is emitted separately when the
 * block ends, and consumers must keep partial parts out of recorded history
 * and must not treat them as complete thoughts.
 */
export interface PartialThoughtPart extends Part {
  thought: true;
  thoughtPartial: true;
}

/** A Part with the transient live-reasoning marker applied. */
type MaybePartialThoughtPart = Part & { thoughtPartial?: boolean };

/** Returns true when the part is a transient live reasoning update. */
export function isPartialThoughtPart(part: Part): boolean {
  return (part as MaybePartialThoughtPart).thoughtPartial === true;
}
