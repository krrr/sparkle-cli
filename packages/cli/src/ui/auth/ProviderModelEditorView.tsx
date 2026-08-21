/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import type { ModelTier, ProviderModel } from 'sparkle-cli-core';
import { TextInput } from '../components/shared/TextInput.js';
import { useTextBuffer } from '../components/shared/text-buffer.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { Command } from '../key/keyMatchers.js';
import { useKeyMatchers } from '../hooks/useKeyMatchers.js';

export interface ProviderModelEditorViewProps {
  model?: ProviderModel;
  onSave: (model: ProviderModel) => void | Promise<void>;
  onCancel: () => void;
  error?: string | null;
}

type ModelFormField = 'id' | 'tier';
const TIERS: Array<ModelTier | 'none'> = ['none', 'flash-lite', 'flash', 'pro'];

export function ProviderModelEditorView({
  model,
  onSave,
  onCancel,
  error,
}: ProviderModelEditorViewProps): React.JSX.Element {
  const keyMatchers = useKeyMatchers();
  const [focusField, setFocusField] = useState<ModelFormField>('id');
  const [tier, setTier] = useState<ModelTier | 'none'>(model?.tier || 'none');

  const { terminalWidth } = useUIState();
  const viewportWidth = Math.max(40, terminalWidth - 12);

  const idBuffer = useTextBuffer({
    initialText: model?.id || '',
    initialCursorOffset: model?.id.length || 0,
    viewport: { width: viewportWidth, height: 1 },
    singleLine: true,
  });

  const fields: ModelFormField[] = ['id', 'tier'];

  const moveFocus = (forward: boolean) => {
    const currentIdx = fields.indexOf(focusField);
    if (forward) {
      setFocusField(fields[(currentIdx + 1) % fields.length]);
    } else {
      setFocusField(fields[(currentIdx - 1 + fields.length) % fields.length]);
    }
  };

  const cycleTier = (forward: boolean) => {
    const currentIdx = TIERS.indexOf(tier);
    if (forward) {
      setTier(TIERS[(currentIdx + 1) % TIERS.length]);
    } else {
      setTier(TIERS[(currentIdx - 1 + TIERS.length) % TIERS.length]);
    }
  };

  const handleSaveAndExit = () => {
    const id = idBuffer.text.trim();
    if (!id) {
      onCancel();
      return;
    }

    const newModel: ProviderModel = {
      id,
      tier: tier === 'none' ? undefined : tier,
    };

    void onSave(newModel);
  };

  useKeypress(
    (key) => {
      if (keyMatchers[Command.ESCAPE](key)) {
        handleSaveAndExit();
        return true;
      }
      if (key.name === 'tab') {
        moveFocus(!key.shift);
        return true;
      }
      if (key.name === 'up') {
        moveFocus(false);
        return true;
      }
      if (key.name === 'down') {
        moveFocus(true);
        return true;
      }
      if (focusField === 'tier') {
        if (key.name === 'left') {
          cycleTier(false);
          return true;
        }
        if (key.name === 'right' || key.name === 'space') {
          cycleTier(true);
          return true;
        }
        if (keyMatchers[Command.RETURN](key)) {
          handleSaveAndExit();
          return true;
        }
      }
      return false;
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column" padding={1} width="100%">
      <Text bold color={theme.text.primary}>
        {model ? `Edit Model: ${model.id}` : 'Add Model'}
      </Text>

      {/* Model ID Field */}
      <Box marginTop={1} flexDirection="column">
        <Text
          color={focusField === 'id' ? theme.text.accent : theme.text.primary}
          bold={focusField === 'id'}
        >
          Model ID:{' '}
          <Text color={theme.text.secondary}>
            (Required, e.g. gemini-2.5-flash, gpt-4o)
          </Text>
        </Text>
        <Box
          borderStyle="round"
          borderColor={
            focusField === 'id' ? theme.ui.focus : theme.border.default
          }
          paddingX={1}
        >
          <TextInput
            buffer={idBuffer}
            focus={focusField === 'id'}
            onSubmit={() => setFocusField('tier')}
            onCancel={handleSaveAndExit}
          />
        </Box>
      </Box>

      {/* Model Tier Selection */}
      <Box marginTop={1} flexDirection="column">
        <Text
          color={focusField === 'tier' ? theme.text.accent : theme.text.primary}
          bold={focusField === 'tier'}
        >
          Model Tier:{' '}
          <Text color={theme.text.secondary}>
            (Used for subagents, routing, and compression)
          </Text>
        </Text>
        <Box flexDirection="row" marginTop={1}>
          {TIERS.map((t) => {
            const isSelected = tier === t;
            return (
              <Box key={t} marginRight={2}>
                <Text
                  color={
                    isSelected ? theme.status.success : theme.text.secondary
                  }
                  bold={isSelected}
                >
                  {isSelected ? '[●] ' : '[ ] '}
                  {t}
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color={theme.status.error}>{error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.text.secondary}>
          (↑/↓ or Tab to switch fields, ←/→ to toggle tier, Esc to save &
          return)
        </Text>
      </Box>
    </Box>
  );
}
