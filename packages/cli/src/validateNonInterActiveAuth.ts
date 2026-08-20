/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  debugLogger,
  OutputFormat,
  ExitCodes,
  getProviderTypeFromEnv,
  type Config,
} from 'sparkle-cli-core';
import { USER_SETTINGS_PATH } from './config/settings.js';
import { handleError } from './utils/errors.js';
import { runExitCleanup } from './utils/cleanup.js';

export async function validateNonInteractiveAuth(nonInteractiveConfig: Config) {
  try {
    const profileService = nonInteractiveConfig.getProviderProfileService();
    const activeProfile = profileService.getActiveProfile();

    if (activeProfile) {
      await profileService.activateProfile(activeProfile.id);
      return activeProfile.providerType;
    }

    const envProviderType = getProviderTypeFromEnv();
    if (envProviderType) {
      const transientProfile = await profileService.createProfile({
        id: 'env-provider',
        providerType: envProviderType,
      });
      await profileService.activateProfile(transientProfile.id);
      return envProviderType;
    }

    const message = `Please configure a provider in your ${USER_SETTINGS_PATH} or specify the GEMINI_API_KEY or OPENAI_API_KEY environment variable before running.`;
    throw new Error(message);
  } catch (error) {
    if (nonInteractiveConfig.getOutputFormat() === OutputFormat.JSON) {
      handleError(
        error instanceof Error ? error : new Error(String(error)),
        nonInteractiveConfig,
        ExitCodes.FATAL_AUTHENTICATION_ERROR,
      );
    } else {
      debugLogger.error(error instanceof Error ? error.message : String(error));
      await runExitCleanup();
      process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
    }
  }
}
