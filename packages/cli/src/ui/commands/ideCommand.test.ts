/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest';
import { ideCommand } from './ideCommand.js';
import { type CommandContext } from './types.js';
import { SettingScope } from '../../config/settings.js';
import { IDE_DEFINITIONS } from 'sparkle-cli-core';
import * as core from 'sparkle-cli-core';

vi.mock('sparkle-cli-core', async (importOriginal) => {
  const original = await importOriginal<typeof core>();
  return {
    ...original,
    getIdeInstaller: vi.fn(original.getIdeInstaller),
    IdeClient: {
      getInstance: vi.fn(),
    },
  };
});

describe('ideCommand', () => {
  let mockContext: CommandContext;
  let mockIdeClient: core.IdeClient;
  let platformSpy: MockInstance;

  beforeEach(() => {
    vi.resetAllMocks();

    mockIdeClient = {
      reconnect: vi.fn(),
      disconnect: vi.fn(),
      connect: vi.fn(),
      getCurrentIde: vi.fn(),
      getConnectionStatus: vi.fn(),
      getDetectedIdeDisplayName: vi.fn(),
    } as unknown as core.IdeClient;

    vi.mocked(core.IdeClient.getInstance).mockResolvedValue(mockIdeClient);
    vi.mocked(mockIdeClient.getDetectedIdeDisplayName).mockReturnValue('VS Code');

    mockContext = {
      ui: {
        addItem: vi.fn(),
      },
      services: {
        settings: {
          setValue: vi.fn(),
        },
        agentContext: {
          config: {
            getIdeMode: vi.fn(),
            setIdeMode: vi.fn(),
            getUsageStatisticsEnabled: vi.fn().mockReturnValue(false),
          },
        },
      },
    } as unknown as CommandContext;

    platformSpy = vi.spyOn(process, 'platform', 'get');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return the ide command with all subcommands statically defined', () => {
    expect(ideCommand).not.toBeNull();
    expect(ideCommand.name).toBe('ide');
    expect(ideCommand.subCommands).toHaveLength(4);
    const subCommandNames = ideCommand.subCommands?.map((cmd) => cmd.name);
    expect(subCommandNames).toContain('status');
    expect(subCommandNames).toContain('install');
    expect(subCommandNames).toContain('enable');
    expect(subCommandNames).toContain('disable');
  });

  it('should return error when ide is not supported and root action is called', async () => {
    vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(undefined);
    const result = await ideCommand.action!(mockContext, '');
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'IDE integration is not supported in your current environment. To use this feature, run Sparkle CLI in one of these supported IDEs: Antigravity, VS Code, or VS Code forks.',
    });
  });

  describe('status subcommand', () => {
    beforeEach(() => {
      vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(IDE_DEFINITIONS.vscode);
    });

    it('should show connected status', async () => {
      vi.mocked(mockIdeClient.getConnectionStatus).mockReturnValue({
        status: core.IDEConnectionStatus.Connected,
      });
      const command = ideCommand;
      const result = await command.subCommands!.find((c) => c.name === 'status')!
        .action!(mockContext, '');
      expect(vi.mocked(mockIdeClient.getConnectionStatus)).toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: '🟢 Connected to VS Code',
      });
    });

    it('should show connecting status', async () => {
      vi.mocked(mockIdeClient.getConnectionStatus).mockReturnValue({
        status: core.IDEConnectionStatus.Connecting,
      });
      const command = ideCommand;
      const result = await command.subCommands!.find((c) => c.name === 'status')!
        .action!(mockContext, '');
      expect(vi.mocked(mockIdeClient.getConnectionStatus)).toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: `🟡 Connecting...`,
      });
    });
    it('should show disconnected status', async () => {
      vi.mocked(mockIdeClient.getConnectionStatus).mockReturnValue({
        status: core.IDEConnectionStatus.Disconnected,
      });
      const command = ideCommand;
      const result = await command.subCommands!.find((c) => c.name === 'status')!
        .action!(mockContext, '');
      expect(vi.mocked(mockIdeClient.getConnectionStatus)).toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: `🔴 Disconnected`,
      });
    });

    it('should show disconnected status with details', async () => {
      const details = 'Something went wrong';
      vi.mocked(mockIdeClient.getConnectionStatus).mockReturnValue({
        status: core.IDEConnectionStatus.Disconnected,
        details,
      });
      const command = ideCommand;
      const result = await command.subCommands!.find((c) => c.name === 'status')!
        .action!(mockContext, '');
      expect(vi.mocked(mockIdeClient.getConnectionStatus)).toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: `🔴 Disconnected: ${details}`,
      });
    });

    it('should return error if ide is not supported', async () => {
      vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(undefined);
      const command = ideCommand;
      const result = await command.subCommands!.find((c) => c.name === 'status')!
        .action!(mockContext, '');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'IDE integration is not supported in your current environment. To use this feature, run Sparkle CLI in one of these supported IDEs: Antigravity, VS Code, or VS Code forks.',
      });
    });
  });

  describe('install subcommand', () => {
    const mockInstall = vi.fn();
    beforeEach(() => {
      vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(IDE_DEFINITIONS.vscode);
      vi.mocked(mockIdeClient.getConnectionStatus).mockReturnValue({
        status: core.IDEConnectionStatus.Disconnected,
      });
      vi.mocked(core.getIdeInstaller).mockReturnValue({
        install: mockInstall,
      });
      platformSpy.mockReturnValue('linux');
    });

    it('should install the extension', async () => {
      vi.useFakeTimers();
      mockInstall.mockResolvedValue({
        success: true,
        message: 'Successfully installed.',
      });

      const command = ideCommand;

      // For the polling loop inside the action.
      vi.mocked(mockIdeClient.getConnectionStatus).mockReturnValue({
        status: core.IDEConnectionStatus.Connected,
      });

      const actionPromise = command.subCommands!.find((c) => c.name === 'install')!
        .action!(mockContext, '');
      await vi.runAllTimersAsync();
      await actionPromise;

      expect(core.getIdeInstaller).toHaveBeenCalledWith(IDE_DEFINITIONS.vscode);
      expect(mockInstall).toHaveBeenCalled();
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: `Installing IDE companion...`,
        }),
        expect.any(Number),
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: 'Successfully installed.',
        }),
        expect.any(Number),
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: '🟢 Connected to VS Code',
        }),
        expect.any(Number),
      );
      vi.useRealTimers();
    }, 10000);

    it('should show an error if installation fails', async () => {
      mockInstall.mockResolvedValue({
        success: false,
        message: 'Installation failed.',
      });

      const command = ideCommand;
      await command.subCommands!.find((c) => c.name === 'install')!.action!(
        mockContext,
        '',
      );

      expect(core.getIdeInstaller).toHaveBeenCalledWith(IDE_DEFINITIONS.vscode);
      expect(mockInstall).toHaveBeenCalled();
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'info',
          text: `Installing IDE companion...`,
        }),
        expect.any(Number),
      );
      expect(mockContext.ui.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          text: 'Installation failed.',
        }),
        expect.any(Number),
      );
    });
  });

  describe('enable and disable subcommands', () => {
    beforeEach(() => {
      vi.mocked(mockIdeClient.getCurrentIde).mockReturnValue(IDE_DEFINITIONS.vscode);
      vi.mocked(mockIdeClient.getConnectionStatus).mockReturnValue({
        status: core.IDEConnectionStatus.Connected,
      });
    });

    it('should enable IDE integration', async () => {
      const command = ideCommand;
      await command.subCommands!.find((c) => c.name === 'enable')!.action!(
        mockContext,
        '',
      );
      expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'ide.enabled',
        true,
      );
      expect(mockIdeClient.connect).toHaveBeenCalled();
    });

    it('should disable IDE integration', async () => {
      const command = ideCommand;
      await command.subCommands!.find((c) => c.name === 'disable')!.action!(
        mockContext,
        '',
      );
      expect(mockContext.services.settings.setValue).toHaveBeenCalledWith(
        SettingScope.User,
        'ide.enabled',
        false,
      );
      expect(mockIdeClient.disconnect).toHaveBeenCalled();
    });
  });
});
