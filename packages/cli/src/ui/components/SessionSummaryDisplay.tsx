/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { StatsDisplay } from './StatsDisplay.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import { useConfig } from '../contexts/ConfigContext.js';
import { escapeShellArg, isWindows, type ShellType } from 'sparkle-cli-core';
import { ThemedGradient } from './ThemedGradient.js';
import { Box } from 'ink';
import { theme } from '../semantic-colors.js';

interface SessionSummaryDisplayProps {
  duration: string;
}

const GOODBYE_TITLE = 'Agent powering down. Goodbye!';

export const SessionSummaryDisplay: React.FC<SessionSummaryDisplayProps> = ({
  duration,
}) => {
  const { stats } = useSessionStats();
  const config = useConfig();

  // Hide stats when no conversations have taken place.
  // Resumed session has no promptCount, must check metrics.
  if (stats.promptCount === 0 && Object.keys(stats.metrics.models).length > 0) {
    return (
      <Box borderStyle="round" borderColor={theme.border.default} paddingX={1}>
        <ThemedGradient bold>{GOODBYE_TITLE}</ThemedGradient>
      </Box>
    );
  }

  const shell: ShellType = isWindows() ? 'powershell' : 'bash';
  const escapedSessionId = escapeShellArg(stats.sessionId, shell);
  const footerSessionId =
    isWindows() &&
    !escapedSessionId.startsWith('"') &&
    !escapedSessionId.startsWith("'")
      ? `"${escapedSessionId}"`
      : escapedSessionId;
  let footer = `To resume this session: sparkle --resume ${footerSessionId}`;

  const worktreeSettings = config.getWorktreeSettings();
  if (worktreeSettings) {
    footer =
      `To resume work in this worktree: cd ${escapeShellArg(worktreeSettings.path, shell)} && sparkle --resume ${footerSessionId}\n` +
      `To remove manually: git worktree remove ${escapeShellArg(worktreeSettings.path, shell)}`;
  }

  return <StatsDisplay title={GOODBYE_TITLE} duration={duration} footer={footer} />;
};
