/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType, loadApiKey } from 'sparkle-cli-core';
import { loadEnvironment, loadSettings } from './settings.js';

export async function validateAuthMethod(
  authMethod: string,
): Promise<string | null> {
  loadEnvironment(loadSettings().merged, process.cwd());

  if (authMethod === AuthType.USE_GEMINI) {
    const key = process.env['GEMINI_API_KEY'] || (await loadApiKey());
    if (!key) {
      return (
        'When using Gemini API, you must specify the GEMINI_API_KEY environment variable.\n' +
        'Update your environment and try again (no reload needed if using .env)!'
      );
    }
    return null;
  }

  if (authMethod === AuthType.USE_OPENAI) {
    if (!process.env['OPENAI_API_KEY']) {
      return (
        'When using an OpenAI-compatible API, you must specify the OPENAI_API_KEY environment variable.\n' +
        'Update your environment and try again (no reload needed if using .env)!'
      );
    }
    return null;
  }

  return 'Invalid auth method selected.';
}
