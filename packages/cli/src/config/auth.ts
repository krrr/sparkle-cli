/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ProviderType,
  loadApiKeyForProfile,
  type ProviderProfile,
} from 'sparkle-cli-core';
import { loadEnvironment, loadSettings } from './settings.js';

export async function validateProfileAuth(
  profile: ProviderProfile,
): Promise<string | null> {
  loadEnvironment(loadSettings().merged, process.cwd());

  if (profile.providerType === ProviderType.USE_GEMINI) {
    const key =
      process.env['GEMINI_API_KEY'] || (await loadApiKeyForProfile(profile.id));
    if (!key && !profile.baseUrl) {
      return (
        'When using Gemini API, you must specify the GEMINI_API_KEY environment variable or configure an API key.\n' +
        'Update your environment and try again (no reload needed if using .env)!'
      );
    }
    return null;
  }

  if (profile.providerType === ProviderType.USE_OPENAI) {
    // The API key is optional for OpenAI-compatible endpoints: local or
    // custom servers (e.g. Ollama) may not require one. When a key is
    // needed, it is read from OPENAI_API_KEY by the core generator.
    return null;
  }

  return 'Invalid auth method selected.';
}
