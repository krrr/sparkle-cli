/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authCommand } from './authCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

describe('authCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    mockContext = createMockCommandContext();
    vi.clearAllMocks();
  });

  it('should have subcommand: signin', () => {
    expect(authCommand.subCommands).toBeDefined();
    expect(authCommand.subCommands).toHaveLength(1);
    expect(authCommand.subCommands?.[0]?.name).toBe('signin');
    expect(authCommand.subCommands?.[0]?.altNames).toContain('login');
  });

  it('should return a dialog action to open the auth dialog when called with no args', () => {
    if (!authCommand.action) {
      throw new Error('The auth command must have an action.');
    }

    const result = authCommand.action(mockContext, '');

    expect(result).toEqual({
      type: 'dialog',
      dialog: 'auth',
    });
  });

  it('should have the correct name and description', () => {
    expect(authCommand.name).toBe('auth');
    expect(authCommand.description).toBe('Manage authentication');
  });

  it('should return auth dialog action for the signin subcommand', () => {
    const loginCommand = authCommand.subCommands?.[0];
    expect(loginCommand?.name).toBe('signin');
    const result = loginCommand!.action!(mockContext, '');
    expect(result).toEqual({ type: 'dialog', dialog: 'auth' });
  });
});
