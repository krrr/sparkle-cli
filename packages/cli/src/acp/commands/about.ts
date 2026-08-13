/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IdeClient, getVersion } from 'sparkle-cli-core';
import type {
  Command,
  CommandContext,
  CommandExecutionResponse,
} from './types.js';
import process from 'node:process';

export class AboutCommand implements Command {
  readonly name = 'about';
  readonly description = 'Show version and environment info';

  async execute(
    context: CommandContext,
    _args: string[] = [],
  ): Promise<CommandExecutionResponse> {
    const osVersion = process.platform;
    let sandboxEnv = 'no sandbox';
    if (process.env['SANDBOX']) {
      sandboxEnv = process.env['SANDBOX'];
    }
    const modelVersion = context.agentContext.config.getModel() || 'Unknown';
    const cliVersion = await getVersion();
    const selectedAuthType =
      context.settings.merged?.security?.auth?.selectedType ?? '';
    const ideClient = await getIdeClientName(context);

    const info = [
      `- Version: ${cliVersion}`,
      `- OS: ${osVersion}`,
      `- Sandbox: ${sandboxEnv}`,
      `- Model: ${modelVersion}`,
      `- Auth Type: ${selectedAuthType}`,
      `- IDE Client: ${ideClient}`,
    ].join('\n');

    return {
      name: this.name,
      data: `Sparkle CLI Info:\n${info}`,
    };
  }
}

async function getIdeClientName(context: CommandContext) {
  if (!context.agentContext.config.getIdeMode()) {
    return '';
  }
  const ideClient = await IdeClient.getInstance();
  return ideClient?.getDetectedIdeDisplayName() ?? '';
}
