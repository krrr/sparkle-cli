/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import type { SessionBrowserState } from '../SessionBrowser.js';

const Kbd = ({ name, shortcut }: { name: string; shortcut: string }) => (
  <>
    {name}: <Text bold>{shortcut}</Text>
  </>
);

/**
 * Navigation help component showing keyboard shortcuts.
 */
export const NavigationHelpDisplay = (): React.JSX.Element => (
  <Box flexDirection="column">
    <Text color={Colors.Gray}>
      <Kbd name="Navigate" shortcut="↑/↓" />
      {'   '}
      <Kbd name="Resume" shortcut="Enter" />
      {'   '}
      <Kbd name="Search" shortcut="/" />
      {'   '}
      <Kbd name="Delete" shortcut="x" />
      {'   '}
      <Kbd name="Quit" shortcut="q" />
    </Text>
    <Text color={Colors.Gray}>
      <Kbd name="Sort" shortcut="s" />
      {'         '}
      <Kbd name="Reverse" shortcut="r" />
      {'      '}
      <Kbd name="First/Last" shortcut="g/G" />
    </Text>
  </Box>
);

/**
 * Delete confirmation display component. Replaces the navigation help bar
 * while a delete confirmation is pending. Keeps the same two-line height as
 * NavigationHelpDisplay so the layout does not jump.
 */
export const DeleteConfirmDisplay = (): React.JSX.Element => (
  <Box flexDirection="column">
    <Text color={Colors.AccentRed}>
      <Kbd name="Delete" shortcut="x" />
      {' again to confirm   '}
      <Kbd name="Cancel" shortcut="Esc" />
    </Text>
    <Text color={Colors.Gray} dimColor>
      Any other key cancels
    </Text>
  </Box>
);

/**
 * Search input display component.
 */
export const SearchModeDisplay = ({
  state,
}: {
  state: SessionBrowserState;
}): React.JSX.Element => (
  <Box marginTop={1}>
    <Text color={Colors.Gray}>Search: </Text>
    <Text color={Colors.AccentPurple}>{state.searchQuery}</Text>
    <Text color={Colors.Gray}> (Esc to cancel)</Text>
  </Box>
);

/**
 * No results display component for empty search results.
 */
export const NoResultsDisplay = ({
  state,
}: {
  state: SessionBrowserState;
}): React.JSX.Element => (
  <Box marginTop={1}>
    <Text color={Colors.Gray} dimColor>
      No sessions found matching &apos;{state.searchQuery}&apos;.
    </Text>
  </Box>
);
