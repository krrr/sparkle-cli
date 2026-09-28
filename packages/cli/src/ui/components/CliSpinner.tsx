/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { debugState } from '../debug.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { Text } from 'ink';

export type SpinnerName = 'dots' | 'sand' | 'toggle';

interface Spinner {
  /** Recommended interval. */
  readonly interval: number;
  /** A list of frames to show for the spinner. */
  readonly frames: string[];
}

export const spinners: Record<SpinnerName, Spinner> = {
  dots: {
    interval: 80,
    frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  },
  sand: {
    interval: 80,
    frames: [
      '⠁',
      '⠂',
      '⠄',
      '⠌',
      '⠔',
      '⠤',
      '⠥',
      '⠦',
      '⠮',
      '⠶',
      '⠷',
      '⠿',
      '⠟',
      '⠛',
      '⠫',
      '⠋',
      '⠍',
      '⠉',
      '⠑',
      '⠡',
    ],
  },
  toggle: {
    interval: 250,
    frames: ['⊶', '⊷'],
  },
};

type SpinnerProps = {
  type?: SpinnerName;
};

export const CliSpinner = (props: SpinnerProps) => {
  const [frame, setFrame] = useState(0);
  const settings = useSettings();
  const shouldShow = settings.merged.ui?.showSpinner !== false;

  const spinner = spinners[props.type || 'dots'];
  useEffect(() => {
    if (!shouldShow) {
      return;
    }
    const timer = setInterval(() => {
      setFrame((previousFrame) => {
        const isLastFrame = previousFrame === spinner.frames.length - 1;
        return isLastFrame ? 0 : previousFrame + 1;
      });
    }, spinner.interval);
    return () => {
      clearInterval(timer);
    };
  }, [spinner, shouldShow]);

  useEffect(() => {
    if (shouldShow) {
      debugState.debugNumAnimatedComponents++;
      return () => {
        debugState.debugNumAnimatedComponents--;
      };
    }
    return undefined;
  }, [shouldShow]);

  if (!shouldShow) {
    return null;
  }

  return React.createElement(Text, null, spinner.frames[frame]);
};
