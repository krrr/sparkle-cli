/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CommandKind,
  type CommandContext,
  type SlashCommand,
} from './types.js';
import process from 'node:process';
import { MessageType, type HistoryItemAbout } from '../types.js';
import { IdeClient, getVersion } from 'sparkle-cli-core';
import { formatBytes } from '../utils/formatters.js';

export const aboutCommand: SlashCommand = {
  name: 'about',
  description: 'Show version info',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  isSafeConcurrent: true,
  action: async (context) => {
    const osVersion = process.platform;
    let sandboxEnv = 'no sandbox';
    if (process.env['SANDBOX']) {
      sandboxEnv = process.env['SANDBOX'];
    }
    const modelVersion =
      context.services.agentContext?.config.getModel() || 'Unknown';
    const cliVersion = await getVersion();
    const profileService =
      context.services.agentContext?.config.getProviderProfileService();
    const activeProfile = profileService?.getActiveProfile();
    const selectedAuthType = activeProfile
      ? `${activeProfile.id} (${activeProfile.providerType})`
      : '';
    const ideClient = await getIdeClientName(context);

    const aboutItem: Omit<HistoryItemAbout, 'id'> = {
      type: MessageType.ABOUT,
      about: {
        cliVersion,
        osVersion,
        sandboxEnv,
        nodeVersion: process.version,
        memoryUsage: formatBytes(process.memoryUsage().rss),
        modelVersion,
        selectedAuthType,
        ideClient,
      },
    };

    context.ui.addItem(aboutItem);
  },
};

async function getIdeClientName(context: CommandContext) {
  if (!context.services.agentContext?.config.getIdeMode()) {
    return '';
  }
  const ideClient = await IdeClient.getInstance();
  return ideClient?.getDetectedIdeDisplayName() ?? '';
}
