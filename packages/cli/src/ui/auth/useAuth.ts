/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import type { LoadedSettings } from '../../config/settings.js';
import { type Config, debugLogger, getErrorMessage } from 'sparkle-cli-core';
import { AuthState } from '../types.js';
import { validateProfileAuth } from '../../config/auth.js';

export const useAuthCommand = (
  _settings: LoadedSettings,
  config: Config,
  initialAuthError: string | null = null,
) => {
  const profileService = config.getProviderProfileService();
  const activeProfile = profileService.getActiveProfile();

  const [authState, setAuthState] = useState<AuthState>(
    initialAuthError || !activeProfile
      ? AuthState.Updating
      : AuthState.Unauthenticated,
  );

  const [authError, setAuthError] = useState<string | null>(initialAuthError);

  const onAuthError = useCallback(
    (error: string | null) => {
      setAuthError(error);
      if (error) {
        setAuthState(AuthState.Updating);
      }
    },
    [setAuthError, setAuthState],
  );

  useEffect(() => {
    void (async () => {
      if (authState !== AuthState.Unauthenticated) {
        return;
      }

      const currentProfile = profileService.getActiveProfile();
      if (!currentProfile) {
        // No provider profile configured or active yet: open ProviderManagerDialog
        setAuthState(AuthState.Updating);
        return;
      }

      const error = await validateProfileAuth(currentProfile).catch(
        (e: unknown) => getErrorMessage(e),
      );

      if (error) {
        onAuthError(error);
        return;
      }

      try {
        await profileService.activateProfile(currentProfile.id);
        debugLogger.log(`Authenticated via profile "${currentProfile.id}".`);
        setAuthError(null);
        setAuthState(AuthState.Authenticated);
      } catch (e) {
        onAuthError(`Failed to sign in. Message: ${getErrorMessage(e)}`);
      }
    })();
  }, [profileService, authState, setAuthState, setAuthError, onAuthError]);

  return {
    authState,
    setAuthState,
    authError,
    onAuthError,
  };
};
