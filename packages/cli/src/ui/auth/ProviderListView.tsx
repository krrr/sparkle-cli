/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { Colors } from '../colors.js';
import { getContrastingTextColor } from '../themes/color-utils.js';
import { ProviderType, type ProviderProfile } from 'sparkle-cli-core';
import { useKeypress } from '../hooks/useKeypress.js';
import { Command } from '../key/keyMatchers.js';
import { useKeyMatchers } from '../hooks/useKeyMatchers.js';

export interface ProviderListViewProps {
  profiles: ProviderProfile[];
  activeProfileId?: string;
  onActivate: (profile: ProviderProfile) => void | Promise<void>;
  onAdd: () => void;
  onEdit: (profile: ProviderProfile) => void;
  onManageModels: (profile: ProviderProfile) => void;
  onDelete: (profile: ProviderProfile) => void | Promise<void>;
  onClose: () => void;
  error?: string | null;
}

export function ProviderListView({
  profiles,
  activeProfileId,
  onActivate,
  onAdd,
  onEdit,
  onManageModels,
  onDelete,
  onClose,
  error,
}: ProviderListViewProps): React.JSX.Element {
  const keyMatchers = useKeyMatchers();
  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (profiles.length === 0) return 0;
    const activeIdx = profiles.findIndex((p) => p.id === activeProfileId);
    return activeIdx >= 0 ? activeIdx : 0;
  });
  const [pendingDeleteProfileId, setPendingDeleteProfileId] = useState<
    string | null
  >(null);

  const clampedIndex =
    profiles.length > 0 ? Math.min(selectedIndex, profiles.length - 1) : 0;
  const selectedProfile = profiles[clampedIndex];

  useKeypress(
    (key) => {
      if (profiles.length === 0) {
        if (keyMatchers[Command.RETURN](key) || key.name === 'a') {
          onAdd();
          return true;
        }
        if (keyMatchers[Command.ESCAPE](key)) {
          onClose();
          return true;
        }
        return false;
      }

      // While a delete confirmation is pending, any key other than d/D
      // (confirm) or escape (cancel) first cancels the confirmation and is
      // then processed normally below.
      if (
        pendingDeleteProfileId !== null &&
        key.name !== 'd' &&
        key.sequence !== 'd' &&
        key.sequence !== 'D' &&
        key.name !== 'escape'
      ) {
        setPendingDeleteProfileId(null);
      }

      if (key.name === 'up') {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : profiles.length - 1));
        return true;
      }
      if (key.name === 'down') {
        setSelectedIndex((prev) => (prev < profiles.length - 1 ? prev + 1 : 0));
        return true;
      }
      if (keyMatchers[Command.RETURN](key)) {
        if (selectedProfile) {
          void onActivate(selectedProfile);
        }
        return true;
      }
      if (key.name === 'a') {
        onAdd();
        return true;
      }
      if (key.name === 'e') {
        if (selectedProfile) {
          onEdit(selectedProfile);
        }
        return true;
      }
      if (key.name === 'm') {
        if (selectedProfile) {
          onManageModels(selectedProfile);
        }
        return true;
      }
      if (key.name === 'd' || key.sequence === 'd' || key.sequence === 'D') {
        if (selectedProfile) {
          if (
            pendingDeleteProfileId === null ||
            pendingDeleteProfileId !== selectedProfile.id
          ) {
            // First press: arm delete confirmation
            setPendingDeleteProfileId(selectedProfile.id);
            return true;
          }
          // Second press: confirm and delete
          setPendingDeleteProfileId(null);
          void onDelete(selectedProfile);
        }
        return true;
      }
      if (key.name === 'escape') {
        if (pendingDeleteProfileId !== null) {
          setPendingDeleteProfileId(null);
        } else {
          onClose();
        }
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  if (profiles.length === 0) {
    return (
      <Box flexDirection="column" padding={1} width="100%">
        <Text bold color={theme.text.primary}>
          Provider Manager
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.secondary}>No providers configured.</Text>
          <Text color={theme.text.secondary}>
            Add a provider to start using Sparkle CLI.
          </Text>
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color={theme.status.error}>{error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            <Text color={theme.text.accent}>[Enter]</Text> Add provider{'   '}
            <Text color={theme.text.secondary}>[Esc] Close</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Text bold color={theme.text.primary}>
        Provider Manager
      </Text>
      <Box marginTop={1} flexDirection="column">
        {profiles.map((profile, idx) => {
          const isSelected = idx === clampedIndex;
          const isActive = profile.id === activeProfileId;
          const isPendingDelete = pendingDeleteProfileId === profile.id;
          const pendingDeleteTextColor =
            isPendingDelete && Colors.AccentRed
              ? getContrastingTextColor(Colors.AccentRed)
              : undefined;

          const typeLabel =
            profile.providerType === ProviderType.USE_GEMINI
              ? 'Gemini'
              : 'OpenAI-compatible';
          const defaultModelText = profile.defaultModel || 'no default model';

          return (
            <Box
              key={profile.id}
              flexDirection="column"
              marginBottom={1}
              backgroundColor={
                isPendingDelete
                  ? Colors.AccentRed
                  : isSelected
                    ? theme.background.focus
                    : undefined
              }
            >
              <Box flexDirection="row">
                <Text
                  bold={isSelected}
                  color={
                    pendingDeleteTextColor ??
                    (isSelected ? theme.status.success : theme.text.primary)
                  }
                >
                  {isActive ? '● ' : '  '}
                  {profile.id}
                </Text>
                {isActive && (
                  <Box justifyContent="flex-end" flexGrow={1}>
                    <Text
                      color={pendingDeleteTextColor ?? theme.status.success}
                    >
                      {'✓ Active'}
                    </Text>
                  </Box>
                )}
              </Box>
              <Box marginLeft={2}>
                <Text color={pendingDeleteTextColor ?? theme.text.secondary}>
                  {typeLabel} · {defaultModelText}
                  {profile.baseUrl ? ` (${profile.baseUrl})` : ''}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>
      {error && (
        <Box marginTop={1}>
          <Text color={theme.status.error}>{error}</Text>
        </Box>
      )}
      {pendingDeleteProfileId !== null ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={Colors.AccentRed}>
            <Text bold color={Colors.AccentRed}>
              [d]
            </Text>{' '}
            again to confirm{'   '}
            <Text color={theme.text.secondary}>[Esc] Cancel</Text>
          </Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            <Text color={theme.text.accent}>[a]</Text> Add{'  '}
            <Text color={theme.text.accent}>[e]</Text> Edit{'  '}
            <Text color={theme.text.accent}>[m]</Text> Models{'  '}
            <Text color={theme.text.accent}>[d]</Text> Delete{'  '}
            <Text color={theme.text.accent}>[Enter]</Text> Activate{'  '}
            <Text color={theme.text.secondary}>[Esc] Close</Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}
