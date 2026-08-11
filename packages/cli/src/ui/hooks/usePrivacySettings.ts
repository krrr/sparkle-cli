/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import type { Config } from 'sparkle-cli-core';

export interface PrivacyState {
  isLoading: boolean;
  error?: string;
  dataCollectionOptIn?: boolean;
}

export const usePrivacySettings = (_config: Config) => {
  const [privacyState, setPrivacyState] = useState<PrivacyState>({
    isLoading: false,
  });

  const updateDataCollectionOptIn = useCallback(async (optIn: boolean) => {
    setPrivacyState({
      isLoading: false,
    });
    return optIn;
  }, []);

  return {
    privacyState,
    updateDataCollectionOptIn,
  };
};
