/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Config } from 'sparkle-cli-core';

export function getContextUsagePercentage(
  promptTokenCount: number,
  config: Config,
): number {
  const contextWindow = config
    .getModelConfigService()
    .getContextWindow(config.getModel());
  if (!(contextWindow > 0)) {
    return 0;
  }
  return promptTokenCount / contextWindow;
}

export function isContextUsageHigh(
  promptTokenCount: number,
  config: Config,
  threshold = 0.6,
): boolean {
  return getContextUsagePercentage(promptTokenCount, config) > threshold;
}
