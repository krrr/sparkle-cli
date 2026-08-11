/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  createDefaultPolicy,
  createSingleModelChain,
  validateModelPolicyChain,
} from './policyCatalog.js';

describe('policyCatalog', () => {
  it('createSingleModelChain produces a single last-resort policy', () => {
    const chain = createSingleModelChain('test-model');
    expect(chain).toHaveLength(1);
    expect(chain[0]?.model).toBe('test-model');
    expect(chain[0]?.isLastResort).toBe(true);
  });

  it('passes when there is exactly one last-resort policy', () => {
    const validChain = [
      createDefaultPolicy('test-model'),
      { ...createDefaultPolicy('last-resort'), isLastResort: true },
    ];
    expect(() => validateModelPolicyChain(validChain)).not.toThrow();
  });

  it('fails when no policies are marked last-resort', () => {
    const chain = [
      createDefaultPolicy('model-a'),
      createDefaultPolicy('model-b'),
    ];
    expect(() => validateModelPolicyChain(chain)).toThrow(
      'must include an `isLastResort`',
    );
  });

  it('fails when a single-model chain is not last-resort', () => {
    const chain = [createDefaultPolicy('lonely-model')];
    expect(() => validateModelPolicyChain(chain)).toThrow(
      'must include an `isLastResort`',
    );
  });

  it('fails when multiple policies are marked last-resort', () => {
    const chain = [
      { ...createDefaultPolicy('model-a'), isLastResort: true },
      { ...createDefaultPolicy('model-b'), isLastResort: true },
    ];
    expect(() => validateModelPolicyChain(chain)).toThrow(
      'must only have one `isLastResort`',
    );
  });

  it('createDefaultPolicy seeds default actions and states', () => {
    const policy = createDefaultPolicy('custom');
    expect(policy.actions.terminal).toBe('prompt');
    expect(policy.actions.unknown).toBe('prompt');
    expect(policy.stateTransitions.terminal).toBe('terminal');
    expect(policy.stateTransitions.unknown).toBe('terminal');
  });
});
