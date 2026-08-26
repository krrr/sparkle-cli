/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { StreamingState } from '../types.js';
import { useTimer } from './useTimer.js';
import { usePhraseCycler } from './usePhraseCycler.js';
import { useState, useEffect, useEffectEvent, useRef } from 'react';
import { getDisplayString, type RetryAttemptPayload } from 'sparkle-cli-core';

const LOW_VERBOSITY_RETRY_HINT_ATTEMPT_THRESHOLD = 2;

export interface UseLoadingIndicatorProps {
  streamingState: StreamingState;
  shouldShowFocusHint: boolean;
  retryStatus: RetryAttemptPayload | null;
  showTips?: boolean;
  showWit?: boolean;
  customWittyPhrases?: string[];
  errorVerbosity?: 'low' | 'full';
  maxLength?: number;
}

export const useLoadingIndicator = ({
  streamingState,
  shouldShowFocusHint,
  retryStatus,
  showTips = true,
  showWit = false,
  customWittyPhrases,
  errorVerbosity = 'full',
  maxLength,
}: UseLoadingIndicatorProps) => {
  const [timerResetKey, setTimerResetKey] = useState(0);
  const isTimerActive = streamingState === StreamingState.Responding;

  const elapsedTimeFromTimer = useTimer(isTimerActive, timerResetKey);

  const isPhraseCyclingActive = streamingState === StreamingState.Responding;
  const isWaiting = streamingState === StreamingState.WaitingForConfirmation;

  const { currentTip, currentWittyPhrase } = usePhraseCycler(
    isPhraseCyclingActive,
    isWaiting,
    shouldShowFocusHint,
    showTips,
    showWit,
    customWittyPhrases,
    maxLength,
  );

  const [retainedElapsedTime, setRetainedElapsedTime] = useState(0);
  const prevStreamingStateRef = useRef<StreamingState | null>(null);

  const handleStreamingStateTransition = useEffectEvent(
    (newStreamingState: StreamingState) => {
      const prevStreamingState = prevStreamingStateRef.current;
      if (
        prevStreamingState === StreamingState.WaitingForConfirmation &&
        newStreamingState === StreamingState.Responding
      ) {
        setTimerResetKey((prevKey) => prevKey + 1);
        setRetainedElapsedTime(0); // Clear retained time when going back to responding
      } else if (
        newStreamingState === StreamingState.Idle &&
        prevStreamingState === StreamingState.Responding
      ) {
        setTimerResetKey((prevKey) => prevKey + 1); // Reset timer when becoming idle from responding
        setRetainedElapsedTime(0);
      } else if (newStreamingState === StreamingState.WaitingForConfirmation) {
        // Capture the time when entering WaitingForConfirmation
        setRetainedElapsedTime(elapsedTimeFromTimer);
      }

      prevStreamingStateRef.current = newStreamingState;
    },
  );

  useEffect(() => {
    handleStreamingStateTransition(streamingState);
  }, [streamingState]);

  const retryPhrase =
    streamingState === StreamingState.Responding && retryStatus
      ? errorVerbosity === 'low'
        ? retryStatus.attempt >= LOW_VERBOSITY_RETRY_HINT_ATTEMPT_THRESHOLD
          ? "This is taking a bit longer, we're still on it."
          : null
        : `Trying to reach ${getDisplayString(retryStatus.model)} (Attempt ${retryStatus.attempt + 1}/${retryStatus.maxAttempts})`
      : null;

  return {
    elapsedTime:
      streamingState === StreamingState.WaitingForConfirmation
        ? retainedElapsedTime
        : elapsedTimeFromTimer,
    currentLoadingPhrase: retryPhrase || currentTip || currentWittyPhrase,
    currentTip,
    currentWittyPhrase,
  };
};
