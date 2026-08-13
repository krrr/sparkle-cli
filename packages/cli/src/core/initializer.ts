/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ProviderType,
  IdeClient,
  IdeConnectionEvent,
  IdeConnectionType,
  logIdeConnection,
  type Config,
  StartSessionEvent,
  logCliConfiguration,
  startupProfiler,
  debugLogger,
  getErrorMessage,
  ValidationRequiredError,
} from 'sparkle-cli-core';
import { type LoadedSettings } from '../config/settings.js';
import { validateTheme } from './theme.js';

export interface InitializationResult {
  authError: string | null;
  themeError: string | null;
  shouldOpenAuthDialog: boolean;
  geminiMdFileCount: number;
}

/**
 * Orchestrates the application's startup initialization.
 * This runs BEFORE the React UI is rendered.
 * @param config The application config.
 * @param settings The loaded application settings.
 * @returns The results of the initialization.
 */
export async function initializeApp(
  config: Config,
  settings: LoadedSettings,
): Promise<InitializationResult> {
  const authHandle = startupProfiler.start('authenticate');
  const authType = settings.merged.security.auth.selectedType;

  let authError: string | null = null;
  if (authType) {
    try {
      await config.refreshAuth(
        authType,
        undefined,
        authType === ProviderType.USE_OPENAI
          ? settings.merged.security.auth.openaiBaseUrl
          : undefined,
      );
    } catch (e) {
      if (!(e instanceof ValidationRequiredError)) {
        // Don't treat validation required as a fatal auth error during
        // startup: this allows the React UI to load and show the error.
        authError = `Failed to set LLM provider. Message: ${getErrorMessage(e)}`;
      }
    }
  }

  authHandle?.end();
  const themeError = validateTheme(settings);

  const shouldOpenAuthDialog =
    settings.merged.security.auth.selectedType === undefined || !!authError;

  logCliConfiguration(
    config,
    new StartSessionEvent(config, config.getToolRegistry()),
  );

  if (config.getIdeMode()) {
    IdeClient.getInstance()
      .then(async (ideClient) => {
        await ideClient.connect();
        logIdeConnection(
          config,
          new IdeConnectionEvent(IdeConnectionType.START),
        );
      })
      .catch((e) => {
        // We log locally if IDE connection setup fails in the background.
        debugLogger.error('Failed to initialize IDE client:', e);
      });
  }

  return {
    authError,
    themeError,
    shouldOpenAuthDialog,
    geminiMdFileCount: config.getGeminiMdFileCount(),
  };
}
