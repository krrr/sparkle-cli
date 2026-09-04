/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_ITEMS, resolveFooterState } from './footerItems.js';
import { createMockSettings } from '../test-utils/settings.js';

describe('footerItems', () => {
  describe('resolveFooterState', () => {
    it('defaults to DEFAULT_ITEMS when ui.footer.items is unset', () => {
      const settings = createMockSettings({}).merged;

      const state = resolveFooterState(settings);
      expect(state.orderedIds).toEqual([
        ...DEFAULT_ITEMS,
        'context-used',
        'memory-usage',
        'session-id',
        'hostname',
        'provider',
        'code-changes',
        'token-count',
      ]);
      expect(state.selectedIds).toEqual(new Set(DEFAULT_ITEMS));
    });

    it('filters out provider item when showProviderInfo is false', () => {
      const settings = createMockSettings({
        ui: {
          showProviderInfo: false,
          footer: {
            items: ['workspace', 'provider', 'model-name'],
          },
        },
      }).merged;

      const state = resolveFooterState(settings);
      expect(state.orderedIds).not.toContain('provider');
      expect(state.selectedIds.has('provider')).toBe(false);
      // It should also not be in the 'others' part of orderedIds
      expect(state.orderedIds).toEqual([
        'workspace',
        'model-name',
        'git-branch',
        'sandbox',
        'context-used',
        'memory-usage',
        'session-id',
        'hostname',
        'code-changes',
        'token-count',
      ]);
    });

    it('includes provider item when showProviderInfo is true', () => {
      const settings = createMockSettings({
        ui: {
          showProviderInfo: true,
          footer: {
            items: ['workspace', 'provider', 'model-name'],
          },
        },
      }).merged;

      const state = resolveFooterState(settings);
      expect(state.orderedIds).toContain('provider');
      expect(state.selectedIds.has('provider')).toBe(true);
    });

    it('includes provider item by default when showProviderInfo is undefined (defaults to true)', () => {
      const settings = createMockSettings({
        ui: {
          footer: {
            items: ['workspace', 'provider', 'model-name'],
          },
        },
      }).merged;

      const state = resolveFooterState(settings);
      expect(state.orderedIds).toContain('provider');
      expect(state.selectedIds.has('provider')).toBe(true);
    });

    it('respects persisted items array', () => {
      const settings = createMockSettings({
        ui: {
          footer: {
            items: ['workspace', 'model-name'],
          },
        },
      }).merged;

      const state = resolveFooterState(settings);
      // items array explicitly omits context-used, so it should not be selected
      expect(state.selectedIds.has('context-used')).toBe(false);
    });
  });
});
