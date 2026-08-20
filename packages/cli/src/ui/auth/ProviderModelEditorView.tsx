/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import type { ProviderModel } from 'sparkle-cli-core';
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

type ModelFormField = 'id' | 'aliases';

export function ProviderModelEditorView({
  model,
  onSave,
  onCancel,
  error,
}: ProviderModelEditorViewProps): React.JSX.Element {
  const keyMatchers = useKeyMatchers();
  const [focusField, setFocusField] = useState<ModelFormField>('id');

  const { terminalWidth } = useUIState();
  const viewportWidth = Math.max(40, terminalWidth - 12);

  const idBuffer = useTextBuffer({
    initialText: model?.id || '',
    initialCursorOffset: model?.id.length || 0,
    viewport: { width: viewportWidth, height: 1 },
    singleLine: true,
  });

  const aliasesBuffer = useTextBuffer({
    initialText: model?.aliases?.join(', ') || '',
    initialCursorOffset: model?.aliases?.join(', ').length || 0,
    viewport: { width: viewportWidth, height: 1 },
    singleLine: true,
  });

  const fields: ModelFormField[] = ['id', 'aliases'];

  const moveFocus = (forward: boolean) => {
    const currentIdx = fields.indexOf(focusField);
    if (forward) {
      setFocusField(fields[(currentIdx + 1) % fields.length]);
    } else {
      setFocusField(fields[(currentIdx - 1 + fields.length) % fields.length]);
    }
  };

  const handleSaveAndExit = () => {
    const id = idBuffer.text.trim();
    if (!id) {
      onCancel();
      return;
    }

    const rawAliases = aliasesBuffer.text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const aliases = rawAliases.length > 0 ? rawAliases : undefined;

    const newModel: ProviderModel = {
      id,
      aliases,
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
      return false;
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column" padding={1} width="100%">
      <Text bold color={theme.text.primary}>
        {model ? `Edit Model: ${model.id}` : 'Add Model'}
      </Text>

      <Box marginTop={1} flexDirection="column">
        <Text
          color={focusField === 'id' ? theme.text.accent : theme.text.primary}
          bold={focusField === 'id'}
        >
          Model ID:{' '}
          <Text color={theme.text.secondary}>
            (Required, e.g. gemini-3.5-flash)
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
            onSubmit={() => setFocusField('aliases')}
            onCancel={handleSaveAndExit}
          />
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text
          color={
            focusField === 'aliases' ? theme.text.accent : theme.text.primary
          }
          bold={focusField === 'aliases'}
        >
          Aliases:{' '}
          <Text color={theme.text.secondary}>
            (Optional, comma-separated, e.g. pro, flash, flash-lite)
          </Text>
        </Text>
        <Box
          borderStyle="round"
          borderColor={
            focusField === 'aliases' ? theme.ui.focus : theme.border.default
          }
          paddingX={1}
        >
          <TextInput
            buffer={aliasesBuffer}
            focus={focusField === 'aliases'}
            onSubmit={handleSaveAndExit}
            onCancel={handleSaveAndExit}
          />
        </Box>
      </Box>

      {error && (
        <Box marginTop={1}>
          <Text color={theme.status.error}>{error}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.text.secondary}>
          (↑/↓ or Tab to switch fields, Esc to save & return)
        </Text>
      </Box>
    </Box>
  );
}
