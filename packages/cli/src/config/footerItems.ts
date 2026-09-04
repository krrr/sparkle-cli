/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MergedSettings } from './settings.js';

export const ALL_ITEMS = [
  {
    id: 'workspace',
    header: 'workspace (/directory)',
    description: 'Current working directory',
  },
  {
    id: 'git-branch',
    header: 'branch',
    description: 'Current git branch name (not shown when unavailable)',
  },
  {
    id: 'sandbox',
    header: 'sandbox',
    description: 'Sandbox type and trust indicator',
  },
  {
    id: 'model-name',
    header: '/model',
    description: 'Current model identifier',
  },
  {
    id: 'context-used',
    header: 'context',
    description: 'Percentage of context window used',
  },
  {
    id: 'memory-usage',
    header: 'memory',
    description: 'Memory used by the application',
  },
  {
    id: 'session-id',
    header: 'session',
    description: 'Unique identifier for the current session',
  },
  {
    id: 'hostname',
    header: 'machine',
    description: 'Current machine hostname',
  },
  {
    id: 'provider',
    header: '/provider',
    description: 'Current provider info',
  },
  {
    id: 'code-changes',
    header: 'diff',
    description: 'Lines added/removed in the session (not shown when zero)',
  },
  {
    id: 'token-count',
    header: 'tokens',
    description: 'Total tokens used in the session (not shown when zero)',
  },
] as const;

export type FooterItemId = (typeof ALL_ITEMS)[number]['id'];

export const DEFAULT_ORDER = [
  'workspace',
  'git-branch',
  'sandbox',
  'model-name',
  'context-used',
  'memory-usage',
  'session-id',
  'hostname',
  'provider',
  'code-changes',
  'token-count',
];

/**
 * Items shown when the user has not configured `ui.footer.items`.
 */
export const DEFAULT_ITEMS = [
  'workspace',
  'git-branch',
  'sandbox',
  'model-name',
];

const VALID_IDS: Set<string> = new Set(ALL_ITEMS.map((i) => i.id));

/**
 * Resolves the ordered list and selected set of footer items from settings.
 * Used by FooterConfigDialog to initialize and reset state.
 */
export function resolveFooterState(settings: MergedSettings): {
  orderedIds: string[];
  selectedIds: Set<string>;
} {
  const showProviderInfo = settings.ui?.showProviderInfo !== false;
  const filteredValidIds = showProviderInfo
    ? VALID_IDS
    : new Set([...VALID_IDS].filter((id) => id !== 'provider'));

  const source = (settings.ui?.footer?.items ?? DEFAULT_ITEMS).filter(
    (id: string) => filteredValidIds.has(id),
  );

  const others = DEFAULT_ORDER.filter(
    (id) => !source.includes(id) && filteredValidIds.has(id),
  );

  return {
    orderedIds: [...source, ...others],
    selectedIds: new Set(source),
  };
}
