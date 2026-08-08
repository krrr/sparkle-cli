/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Content,
  type ContentListUnion,
  type ContentUnion,
  type Part,
  type PartUnion,
} from '@google/genai';

/**
 * Converts a ContentListUnion into an array of Content.
 */
export function toContents(contents: ContentListUnion): Content[] {
  if (Array.isArray(contents)) {
    // it's a Content[] or a PartsUnion[]
    return contents.map(toContent);
  }
  // it's a Content or a PartsUnion
  return [toContent(contents)];
}

function isPart(c: ContentUnion): c is PartUnion {
  return (
    typeof c === 'object' &&
    c !== null &&
    !Array.isArray(c) &&
    !('parts' in c) &&
    !('role' in c)
  );
}

function toContent(content: ContentUnion): Content {
  if (Array.isArray(content)) {
    // it's a PartsUnion[]
    return {
      role: 'user',
      parts: toParts(content),
    };
  }
  if (typeof content === 'string') {
    // it's a string
    return {
      role: 'user',
      parts: [{ text: content }],
    };
  }
  if (!isPart(content)) {
    // it's a Content - process parts to handle thought filtering
    return {
      ...content,
      parts: content.parts
        ? toParts(content.parts.filter((p) => p != null))
        : [],
    };
  }
  // it's a Part
  return {
    role: 'user',
    parts: [toPart(content)],
  };
}

/**
 * Converts an array of PartUnion into an array of Part.
 */
export function toParts(parts: PartUnion[]): Part[] {
  return parts.map(toPart);
}

function toPart(part: PartUnion): Part {
  if (typeof part === 'string') {
    // it's a string
    return { text: part };
  }

  // Handle thought parts for API compatibility
  // Some APIs expect parts to have certain required "oneof" fields initialized,
  // but thought parts don't conform to this schema and cause API failures
  if ('thought' in part && part.thought) {
    const thoughtText = `[Thought: ${part.thought}]`;

    const newPart = { ...part };
    delete (newPart as Record<string, unknown>)['thought'];

    const hasApiContent =
      'functionCall' in newPart ||
      'functionResponse' in newPart ||
      'inlineData' in newPart ||
      'fileData' in newPart;

    if (hasApiContent) {
      // It's a functionCall or other non-text part. Just strip the thought.
      return newPart;
    }

    // If no other valid API content, this must be a text part.
    // Combine existing text (if any) with the thought, preserving other properties.
    const text = (newPart as { text?: unknown }).text;
    const existingText = text ? String(text) : '';
    const combinedText = existingText
      ? `${existingText}\n${thoughtText}`
      : thoughtText;

    return {
      ...newPart,
      text: combinedText,
    };
  }

  return part;
}
