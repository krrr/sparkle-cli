/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseThought } from './thoughtUtils.js';

describe('parseThought', () => {
  it.each([
    {
      name: 'a standard thought with a fully wrapped first-line subject',
      rawText: '**Subject**\nThis is the description.',
      expected: {
        subject: 'Subject',
        description: 'This is the description.',
      },
    },
    {
      name: 'leading and trailing whitespace in the raw string',
      rawText: '  **Subject**\ndescription with spaces   ',
      expected: { subject: 'Subject', description: 'description with spaces' },
    },
    {
      name: 'whitespace surrounding the subject content',
      rawText: '** Subject  **',
      expected: { subject: 'Subject', description: '' },
    },
    {
      name: 'a thought with only a subject',
      rawText: '**Only Subject**',
      expected: { subject: 'Only Subject', description: '' },
    },
    {
      name: 'a thought with only a description (no subject)',
      rawText: 'This is just a description.',
      expected: { subject: '', description: 'This is just a description.' },
    },
    {
      name: 'an empty string input',
      rawText: '',
      expected: { subject: '', description: '' },
    },
    {
      name: 'a wrapped single-line subject followed by a multi-line description',
      rawText:
        '**Assessing the request**\nHere is a description\nspread across lines.',
      expected: {
        subject: 'Assessing the request',
        description: 'Here is a description\nspread across lines.',
      },
    },
    {
      name: 'trailing whitespace after the closing delimiter on the first line',
      rawText: '**Subject**  \nBody line',
      expected: { subject: 'Subject', description: 'Body line' },
    },
    {
      name: 'CRLF line endings',
      rawText: '**Subject**\r\nBody line',
      expected: { subject: 'Subject', description: 'Body line' },
    },
    // Inline bold anywhere other than a fully wrapped first line must NOT be
    // mistaken for a subject (e.g. plain reasoning text from OpenAI-compatible
    // providers).
    {
      name: 'an inline subject on the same line as the description',
      rawText: '**Subject:** This is the description.',
      expected: {
        subject: '',
        description: '**Subject:** This is the description.',
      },
    },
    {
      name: 'inline bold after a same-line description',
      rawText: '  **Subject** description with spaces   ',
      expected: {
        subject: '',
        description: '**Subject** description with spaces',
      },
    },
    {
      name: 'a subject tag spanning multiple lines',
      rawText:
        '**Multi-line\nSubject**\nHere is a description\nspread across lines.',
      expected: {
        subject: '',
        description:
          '**Multi-line\nSubject**\nHere is a description\nspread across lines.',
      },
    },
    {
      name: 'multiple bold fragments in the text',
      rawText: '**First** some text **Second**',
      expected: { subject: '', description: '**First** some text **Second**' },
    },
    {
      name: 'bold fragment in the middle of the line',
      rawText: 'Prefix text **Subject** Suffix text.',
      expected: {
        subject: '',
        description: 'Prefix text **Subject** Suffix text.',
      },
    },
    {
      name: 'an unclosed subject tag',
      rawText: 'Text with **an unclosed subject',
      expected: { subject: '', description: 'Text with **an unclosed subject' },
    },
    {
      name: 'an empty subject tag in the middle of the line',
      rawText: 'A thought with **** in the middle.',
      expected: {
        subject: '',
        description: 'A thought with **** in the middle.',
      },
    },
  ])('should correctly parse $name', ({ rawText, expected }) => {
    expect(parseThought(rawText)).toEqual(expected);
  });
});
