/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type MockInstance,
} from 'vitest';
import {
  runDeferredCommand,
  defer,
  setDeferredCommand,
  type DeferredCommand,
} from './deferred.js';
import { ExitCodes } from 'sparkle-cli-core';
import type { ArgumentsCamelCase, CommandModule } from 'yargs';
import { createMockSettings } from './test-utils/settings.js';

const { mockRunExitCleanup, mockCoreEvents } = vi.hoisted(() => ({
  mockRunExitCleanup: vi.fn(),
  mockCoreEvents: {
    emitFeedback: vi.fn(),
  },
}));

vi.mock('sparkle-cli-core', async () => {
  const actual = await vi.importActual('sparkle-cli-core');
  return {
    ...actual,
    coreEvents: mockCoreEvents,
  };
});

vi.mock('./utils/cleanup.js', () => ({
  runExitCleanup: mockRunExitCleanup,
}));

let mockExit: MockInstance;

describe('deferred', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);
    setDeferredCommand(undefined as unknown as DeferredCommand); // Reset deferred command
  });

  describe('runDeferredCommand', () => {
    it('should do nothing if no deferred command is set', async () => {
      await runDeferredCommand(createMockSettings().merged);
      expect(mockCoreEvents.emitFeedback).not.toHaveBeenCalled();
      expect(mockExit).not.toHaveBeenCalled();
    });

    it('should execute the deferred command', async () => {
      const mockHandler = vi.fn();
      setDeferredCommand({
        handler: mockHandler,
        argv: { _: [], $0: 'gemini' } as ArgumentsCamelCase,
        commandName: 'mcp',
      });

      const settings = createMockSettings().merged;
      await runDeferredCommand(settings);
      expect(mockHandler).toHaveBeenCalled();
      expect(mockRunExitCleanup).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(ExitCodes.SUCCESS);
    });
  });

  describe('defer', () => {
    it('should wrap a command module and defer execution', async () => {
      const originalHandler = vi.fn();
      const commandModule: CommandModule = {
        command: 'test',
        describe: 'test command',
        handler: originalHandler,
      };

      const deferredModule = defer(commandModule);
      expect(deferredModule.command).toBe(commandModule.command);

      // Execute the wrapper handler
      const argv = { _: [], $0: 'gemini' } as ArgumentsCamelCase;
      await deferredModule.handler(argv);

      // Should check that it set the deferred command, but didn't run original handler yet
      expect(originalHandler).not.toHaveBeenCalled();

      // Now manually run it to verify it captured correctly
      await runDeferredCommand(createMockSettings().merged);
      expect(originalHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.anything(),
        }),
      );
      expect(mockExit).toHaveBeenCalledWith(ExitCodes.SUCCESS);
    });

    it('should use parentCommandName if provided', async () => {
      const mockHandler = vi.fn();
      const commandModule: CommandModule = {
        command: 'subcommand',
        describe: 'sub command',
        handler: mockHandler,
      };

      const deferredModule = defer(commandModule, 'parent');
      await deferredModule.handler({} as ArgumentsCamelCase);

      const deferredMcp = defer(commandModule, 'mcp');
      await deferredMcp.handler({} as ArgumentsCamelCase);

      await runDeferredCommand(createMockSettings().merged);

      expect(mockHandler).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(ExitCodes.SUCCESS);
    });

    it('should fallback to unknown if no parentCommandName is provided', async () => {
      const mockHandler = vi.fn();
      const commandModule: CommandModule = {
        command: ['foo', 'infoo'],
        describe: 'foo command',
        handler: mockHandler,
      };

      const deferredModule = defer(commandModule);
      await deferredModule.handler({} as ArgumentsCamelCase);

      // Verify it runs even without a parent command name and defaulted to 'unknown'.
      await runDeferredCommand(createMockSettings().merged);

      expect(mockHandler).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(ExitCodes.SUCCESS);
    });
  });
});
