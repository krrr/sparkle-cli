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
    const key =
      process.env['GEMINI_API_KEY'] || (await loadApiKey(AuthType.USE_GEMINI));
    if (!key) {
      return (
        'When using Gemini API, you must specify the GEMINI_API_KEY environment variable.\n' +
        'Update your environment and try again (no reload needed if using .env)!'
      );
    }
    return null;
  }

  if (authMethod === AuthType.USE_OPENAI) {
    // The API key is optional for OpenAI-compatible endpoints: local or
    // custom servers (e.g. Ollama) may not require one. When a key is
    // needed, it is read from OPENAI_API_KEY by the core generator.
    return null;
  }

  return 'Invalid auth method selected.';
}
