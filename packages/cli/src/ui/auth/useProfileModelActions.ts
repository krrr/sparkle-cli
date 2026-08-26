/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState } from 'react';
import {
  type ProviderModel,
  type ProviderProfileService,
  getErrorMessage,
} from 'sparkle-cli-core';

export interface ProfileModelActions {
  /** Error message from the last failed operation, if any. */
  error: string | null;
  setError: (error: string | null) => void;
  addModel: (model: ProviderModel) => Promise<void>;
  updateModel: (oldModelId: string, model: ProviderModel) => Promise<void>;
  deleteModel: (modelId: string) => Promise<void>;
  setDefaultModel: (modelId: string) => Promise<void>;
}

/**
 * Wires the CRUD operations for a profile's models to the
 * {@link ProviderProfileService}, handling per-operation error reporting and
 * notifying `onChanged` after each successful mutation.
 */
export function useProfileModelActions(
  profileService: ProviderProfileService | undefined,
  profileId: string | undefined,
  onChanged?: () => void,
): ProfileModelActions {
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (operation: () => Promise<unknown>): Promise<void> => {
      setError(null);
      try {
        await operation();
        onChanged?.();
      } catch (e) {
        setError(getErrorMessage(e));
      }
    },
    [onChanged],
  );

  const addModel = useCallback(
    (model: ProviderModel): Promise<void> => {
      if (!profileService || !profileId) {
        return Promise.resolve();
      }
      return run(() => profileService.addModel(profileId, model));
    },
    [profileService, profileId, run],
  );

  const updateModel = useCallback(
    (oldModelId: string, model: ProviderModel): Promise<void> => {
      if (!profileService || !profileId) {
        return Promise.resolve();
      }
      return run(() =>
        profileService.updateModel(profileId, oldModelId, model),
      );
    },
    [profileService, profileId, run],
  );

  const deleteModel = useCallback(
    (modelId: string): Promise<void> => {
      if (!profileService || !profileId) {
        return Promise.resolve();
      }
      return run(() => profileService.removeModel(profileId, modelId));
    },
    [profileService, profileId, run],
  );

  const setDefaultModel = useCallback(
    (modelId: string): Promise<void> => {
      if (!profileService || !profileId) {
        return Promise.resolve();
      }
      return run(() => profileService.setDefaultModel(profileId, modelId));
    },
    [profileService, profileId, run],
  );

  return {
    error,
    setError,
    addModel,
    updateModel,
    deleteModel,
    setDefaultModel,
  };
}
