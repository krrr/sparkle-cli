/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export enum LlmRole {
  MAIN = 'main',
  SUBAGENT = 'subagent',
  UTILITY_TOOL = 'utility_tool',
  UTILITY_COMPRESSOR = 'utility_compressor',
  UTILITY_SUMMARIZER = 'utility_summarizer',
  UTILITY_ROUTER = 'utility_router',
  UTILITY_LOOP_DETECTOR = 'utility_loop_detector',
  UTILITY_STATE_SNAPSHOT_PROCESSOR = 'utility_state_snapshot_processor',
}
