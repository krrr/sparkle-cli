/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  HistoryItemStats,
  HistoryItemModelStats,
  HistoryItemToolStats,
} from '../types.js';
import { MessageType } from '../types.js';
import { formatDuration } from '../utils/formatters.js';
import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';

function getSelectedAuthType(context: CommandContext) {
  const profileService =
    context.services.agentContext?.config.getProviderProfileService();
  const activeProfile = profileService?.getActiveProfile();
  return activeProfile
    ? `${activeProfile.id} (${activeProfile.providerType})`
    : '';
}

async function defaultSessionView(context: CommandContext) {
  const now = new Date();
  const { sessionStartTime } = context.session.stats;
  if (!sessionStartTime) {
    context.ui.addItem({
      type: MessageType.ERROR,
      text: 'Session start time is unavailable, cannot calculate stats.',
    });
    return;
  }
  const wallDuration = now.getTime() - sessionStartTime.getTime();

  const selectedAuthType = getSelectedAuthType(context);
  const currentModel = context.services.agentContext?.config.getModel();

  const statsItem: HistoryItemStats = {
    type: MessageType.STATS,
    duration: formatDuration(wallDuration),
    selectedAuthType,
    currentModel,
  };

  context.ui.addItem(statsItem);
}

export const statsCommand: SlashCommand = {
  name: 'stats',
  altNames: ['usage'],
  description: 'Check session stats. Usage: /stats [session|model|tools]',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  isSafeConcurrent: true,
  action: async (context: CommandContext) => {
    await defaultSessionView(context);
  },
  subCommands: [
    {
      name: 'session',
      description: 'Show session-specific usage statistics',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      isSafeConcurrent: true,
      action: async (context: CommandContext) => {
        await defaultSessionView(context);
      },
    },
    {
      name: 'model',
      description: 'Show model-specific usage statistics',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      isSafeConcurrent: true,
      action: (context: CommandContext) => {
        const selectedAuthType = getSelectedAuthType(context);
        const currentModel = context.services.agentContext?.config.getModel();
        context.ui.addItem({
          type: MessageType.MODEL_STATS,
          selectedAuthType,
          currentModel,
        } as HistoryItemModelStats);
      },
    },
    {
      name: 'tools',
      description: 'Show tool-specific usage statistics',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      isSafeConcurrent: true,
      action: (context: CommandContext) => {
        context.ui.addItem({
          type: MessageType.TOOL_STATS,
        } as HistoryItemToolStats);
      },
    },
  ],
};
