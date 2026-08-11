/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type Config,
  type FallbackModelHandler,
  type FallbackIntent,
  TerminalQuotaError,
  ModelNotFoundError,
  VALID_GEMINI_MODELS,
  isProModel,
  getDisplayString,
} from 'sparkle-cli-core';
import { useEffect } from 'react';
import { type UseHistoryManagerReturn } from './useHistoryManager.js';
import { MessageType } from '../types.js';
import type { LoadedSettings } from '../../config/settings.js';

interface UseQuotaAndFallbackArgs {
  config: Config;
  historyManager: UseHistoryManagerReturn;
  settings: LoadedSettings;
  setModelSwitchedFromQuotaError: (value: boolean) => void;
  errorVerbosity?: 'low' | 'full';
}

/**
 * Sets up the fallback model handler that automatically switches to a
 * fallback model when the current model hits a quota or capacity limit.
 */
export function useQuotaAndFallback({
  config,
  historyManager,
  settings,
  setModelSwitchedFromQuotaError,
  errorVerbosity = 'full',
}: UseQuotaAndFallbackArgs) {
  // Set up Flash fallback handler
  useEffect(() => {
    const fallbackHandler: FallbackModelHandler = async (
      failedModel,
      fallbackModel,
      error,
    ): Promise<FallbackIntent | null> => {
      const usageLimitReachedModel = isProModel(failedModel)
        ? 'all Pro models'
        : failedModel;

      if (error instanceof TerminalQuotaError) {
        const messageLines = [
          `Usage limit reached for ${usageLimitReachedModel}.`,
          error.retryDelayMs
            ? `Access resets at ${getResetTimeMessage(error.retryDelayMs)}.`
            : null,
          `/stats model for usage details`,
          `/model to switch models.`,
        ].filter(Boolean);
        historyManager.addItem(
          { type: MessageType.ERROR, text: messageLines.join('\n') },
          Date.now(),
        );
        return 'retry_later';
      }

      if (error instanceof ModelNotFoundError) {
        const messageLines = VALID_GEMINI_MODELS.has(failedModel)
          ? [
              `It seems like you don't have access to ${getDisplayString(failedModel)}.`,
              `Your admin might have disabled the access to this model.`,
            ]
          : [
              `Model "${failedModel}" was not found or is invalid.`,
              `/model to switch models.`,
            ];
        historyManager.addItem(
          { type: MessageType.ERROR, text: messageLines.join('\n') },
          Date.now(),
        );
        return 'retry_later';
      }

      // In low verbosity mode, auto-retry transient capacity failures
      // without interrupting the user.
      if (errorVerbosity === 'low') {
        return 'retry_once';
      }

      setModelSwitchedFromQuotaError(true);
      config.setQuotaErrorOccurred(true);
      historyManager.addItem(
        {
          type: MessageType.INFO,
          text: `Switching to fallback model ${fallbackModel} due to high demand.`,
        },
        Date.now(),
      );
      return 'retry_always';
    };

    config.setFallbackModelHandler(fallbackHandler);
  }, [
    config,
    historyManager,
    settings,
    setModelSwitchedFromQuotaError,
    errorVerbosity,
  ]);
}

function getResetTimeMessage(delayMs: number): string {
  const resetDate = new Date(Date.now() + delayMs);

  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return timeFormatter.format(resetDate);
}
