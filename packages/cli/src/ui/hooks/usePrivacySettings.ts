/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import type { Config } from '@google/gemini-cli-core';

export interface PrivacyState {
  isLoading: boolean;
  error?: string;
  isFreeTier?: boolean;
  dataCollectionOptIn?: boolean;
  /**
   * True when the signed-in account has no consumer Code Assist tier, so the
   * data-collection opt-in isn't applicable. Code Assist authentication has
   * been removed, so this is always the case.
   */
  isTierUnavailable?: boolean;
}

export const usePrivacySettings = (_config: Config) => {
  const [privacyState, setPrivacyState] = useState<PrivacyState>({
    isLoading: false,
    isTierUnavailable: true,
  });

  const updateDataCollectionOptIn = useCallback(async (optIn: boolean) => {
    setPrivacyState({
      isLoading: false,
      isTierUnavailable: true,
    });
    return optIn;
  }, []);

  return {
    privacyState,
    updateDataCollectionOptIn,
  };
};
