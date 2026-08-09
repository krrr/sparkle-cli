/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { relaunchApp } from '../../utils/processUtils.js';

interface LoginRestartDialogProps {
  onDismiss: () => void;
  message?: string;
}

export const LoginRestartDialog = ({
  onDismiss,
  message,
}: LoginRestartDialogProps) => {
  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onDismiss();
        return true;
      } else if (key.name === 'r' || key.name === 'R') {
        setTimeout(async () => {
          await relaunchApp();
        }, 100);
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  const displayMessage =
    message ??
    "You've successfully signed in with Google. Gemini CLI needs to be restarted.";

  return (
    <Box
      borderStyle="round"
      borderColor={theme.status.warning}
      paddingX={1}
      flexDirection="column"
    >
      <Text color={theme.status.warning}>{displayMessage}</Text>
      <Text color={theme.status.warning}>
        Press R to restart, or Esc to choose a different authentication method.
      </Text>
    </Box>
  );
};
