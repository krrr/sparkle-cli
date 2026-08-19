/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isDevelopment } from '../utils/installationInfo.js';
import type { ICommandLoader } from './types.js';
import { type SlashCommand } from '../ui/commands/types.js';
import type { Config } from 'sparkle-cli-core';
import { startupProfiler } from 'sparkle-cli-core';
import { aboutCommand } from '../ui/commands/aboutCommand.js';
import { agentsCommand } from '../ui/commands/agentsCommand.js';
import { providerCommand } from '../ui/commands/providerCommand.js';
import { bugMemoryCommand } from '../ui/commands/bugMemoryCommand.js';
import { clearCommand } from '../ui/commands/clearCommand.js';
import { commandsCommand } from '../ui/commands/commandsCommand.js';
import { compactCommand } from '../ui/commands/compactCommand.js';
import { copyCommand } from '../ui/commands/copyCommand.js';
import { corgiCommand } from '../ui/commands/corgiCommand.js';
import { exportSessionCommand } from '../ui/commands/exportSessionCommand.js';
import { directoryCommand } from '../ui/commands/directoryCommand.js';
import { editorCommand } from '../ui/commands/editorCommand.js';
import { extensionsCommand } from '../ui/commands/extensionsCommand.js';
import { footerCommand } from '../ui/commands/footerCommand.js';
import { helpCommand } from '../ui/commands/helpCommand.js';
import { rewindCommand } from '../ui/commands/rewindCommand.js';
import { hooksCommand } from '../ui/commands/hooksCommand.js';
import { ideCommand } from '../ui/commands/ideCommand.js';
import { initCommand } from '../ui/commands/initCommand.js';
import { mcpCommand } from '../ui/commands/mcpCommand.js';
import { memoryCommand } from '../ui/commands/memoryCommand.js';
import { modelCommand } from '../ui/commands/modelCommand.js';
import { permissionsCommand } from '../ui/commands/permissionsCommand.js';
import { planCommand } from '../ui/commands/planCommand.js';
import { policiesCommand } from '../ui/commands/policiesCommand.js';
import { profileCommand } from '../ui/commands/profileCommand.js';
import { quitCommand } from '../ui/commands/quitCommand.js';
import { restoreCommand } from '../ui/commands/restoreCommand.js';
import { chatCommand, debugCommand } from '../ui/commands/chatCommand.js';
import { statsCommand } from '../ui/commands/statsCommand.js';
import { themeCommand } from '../ui/commands/themeCommand.js';
import { toolsCommand } from '../ui/commands/toolsCommand.js';
import { skillsCommand } from '../ui/commands/skillsCommand.js';
import { settingsCommand } from '../ui/commands/settingsCommand.js';
import { tasksCommand } from '../ui/commands/tasksCommand.js';
import { vimCommand } from '../ui/commands/vimCommand.js';
import { terminalSetupCommand } from '../ui/commands/terminalSetupCommand.js';
import { voiceCommand } from '../ui/commands/voiceCommand.js';

/**
 * Loads the core, hard-coded slash commands that are an integral part
 * of the Sparkle CLI application.
 */
export class BuiltinCommandLoader implements ICommandLoader {
  constructor(private config: Config | null) {}

  /**
   * Gathers all raw built-in command definitions, injects dependencies where
   * needed (e.g., config) and filters out any that are not available.
   *
   * @param _signal An AbortSignal (unused for this synchronous loader).
   * @returns A promise that resolves to an array of `SlashCommand` objects.
   */
  async loadCommands(_signal: AbortSignal): Promise<SlashCommand[]> {
    const handle = startupProfiler.start('load_builtin_commands');
    const isDebugMode = this.config?.getDebugMode() ?? !!process.env['DEBUG'];
    const addDebugToChatSubCommands = (
      subCommands: SlashCommand[] | undefined,
    ): SlashCommand[] | undefined => {
      if (!subCommands) {
        return subCommands;
      }

      const withNestedCompatibility = subCommands.map((subCommand) => {
        if (subCommand.name !== 'checkpoints') {
          return subCommand;
        }

        return {
          ...subCommand,
          subCommands: addDebugToChatSubCommands(subCommand.subCommands),
        };
      });

      if (!isDebugMode) {
        return withNestedCompatibility;
      }

      return withNestedCompatibility.some(
        (cmd) => cmd.name === debugCommand.name,
      )
        ? withNestedCompatibility
        : [
            ...withNestedCompatibility,
            { ...debugCommand, suggestionGroup: 'checkpoints' },
          ];
    };

    const allDefinitions: Array<SlashCommand | null> = [
      aboutCommand,
      ...(this.config?.isAgentsEnabled() ? [agentsCommand] : []),
      providerCommand,
      bugMemoryCommand,
      clearCommand,
      commandsCommand,
      compactCommand,
      copyCommand,
      corgiCommand,
      exportSessionCommand,
      directoryCommand,
      editorCommand,
      extensionsCommand(this.config?.getEnableExtensionReloading()),
      helpCommand,
      footerCommand,
      ...(this.config?.getEnableHooksUI() ? [hooksCommand] : []),
      rewindCommand,
      await ideCommand(),
      initCommand,
      mcpCommand,
      memoryCommand(this.config),
      modelCommand,
      ...(this.config?.getFolderTrust() ? [permissionsCommand] : []),
      ...(this.config?.isPlanEnabled() ? [planCommand] : []),
      policiesCommand,
      ...(isDevelopment ? [profileCommand] : []),
      quitCommand,
      restoreCommand(this.config),
      {
        ...chatCommand,
        subCommands: addDebugToChatSubCommands(chatCommand.subCommands),
      },
      statsCommand,
      themeCommand,
      toolsCommand,
      ...(this.config?.isSkillsSupportEnabled() ? [skillsCommand] : []),
      settingsCommand,
      tasksCommand,
      vimCommand,
      terminalSetupCommand,
      ...(this.config?.isVoiceModeEnabled() ? [voiceCommand] : []),
    ];
    handle?.end();
    return allDefinitions.filter((cmd): cmd is SlashCommand => cmd !== null);
  }
}
