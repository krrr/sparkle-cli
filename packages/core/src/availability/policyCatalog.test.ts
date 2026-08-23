/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  createDefaultPolicy,
  createSingleModelChain,
} from './policyCatalog.js';

describe('policyCatalog', () => {
  it('createSingleModelChain produces a single last-resort policy', () => {
    const chain = createSingleModelChain('test-model');
    expect(chain).toHaveLength(1);
    expect(chain[0]?.model).toBe('test-model');
    expect(chain[0]?.isLastResort).toBe(true);
  });

  it('createDefaultPolicy seeds default actions and states', () => {
    const policy = createDefaultPolicy('custom');
    expect(policy.actions.terminal).toBe('prompt');
    expect(policy.actions.unknown).toBe('prompt');
    expect(policy.stateTransitions.terminal).toBe('terminal');
    expect(policy.stateTransitions.unknown).toBe('terminal');
  });
});
