/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { providerCommand } from './providerCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

describe('authCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = createMockCommandContext();
    vi.clearAllMocks();
  });

  it('should return a dialog action to open the auth dialog when called with no args', () => {
    if (!providerCommand.action) {
      throw new Error('The auth command must have an action.');
    }

    const result = providerCommand.action(mockContext, '');

    expect(result).toEqual({
      type: 'dialog',
      dialog: 'auth',
    });
  });

  it('should have the correct name and description', () => {
    expect(providerCommand.name).toBe('provider');
    expect(providerCommand.description).toBe('Setup LLM API providers');
  });
});
