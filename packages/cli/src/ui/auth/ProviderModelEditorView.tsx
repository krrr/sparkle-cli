/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import {
  type ModelTier,
  type ProviderModel,
  type ReasoningEffort,
} from 'sparkle-cli-core';
import { TextInput } from '../components/shared/TextInput.js';
import { InlineRadioGroup } from '../components/shared/InlineRadioGroup.js';
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

const FORM_FIELDS = ['id', 'tier', 'reasoningEffort', 'contextWindow'] as const;
type ModelFormField = (typeof FORM_FIELDS)[number];

const TIERS: Array<ModelTier | 'none'> = ['none', 'flash-lite', 'flash', 'pro'];
// The UI exposes the common levels; the full set (minimal/medium/xhigh/...)
// can be set directly in settings.json.
const EFFORTS: Array<ReasoningEffort | 'default'> = [
  'default',
  'none',
  'low',
  'high',
  'max',
];

export function ProviderModelEditorView({
  model,
  onSave,
  onCancel,
  error,
}: ProviderModelEditorViewProps): React.JSX.Element {
  const keyMatchers = useKeyMatchers();
  const [focusField, setFocusField] = useState<ModelFormField>(FORM_FIELDS[0]);
  const [tier, setTier] = useState<ModelTier | 'none'>(model?.tier || 'none');
  const [effort, setEffort] = useState<ReasoningEffort | 'default'>(
    model?.generateConfig?.reasoningEffort ?? 'default',
  );

  const { terminalWidth } = useUIState();
  const viewportWidth = Math.max(40, terminalWidth - 12);

  const idBuffer = useTextBuffer({
    initialText: model?.id || '',
    initialCursorOffset: model?.id.length || 0,
    viewport: { width: viewportWidth, height: 1 },
    singleLine: true,
  });
  const ctxBuffer = useTextBuffer({
    initialText: String(model?.contextWindow ?? ''),
    viewport: { width: viewportWidth, height: 1 },
    singleLine: true,
    inputFilter: (t) => t.replace(/\D/g, ''),
  });

  const moveFocus = (forward: boolean) => {
    const currentIdx = FORM_FIELDS.indexOf(focusField);
    if (forward) {
      setFocusField(FORM_FIELDS[(currentIdx + 1) % FORM_FIELDS.length]);
    } else {
      setFocusField(
        FORM_FIELDS[(currentIdx - 1 + FORM_FIELDS.length) % FORM_FIELDS.length],
      );
    }
  };

  const handleSaveAndExit = () => {
    const id = idBuffer.text.trim();
    if (!id) {
      onCancel();
      return;
    }
    const contextWindow = parseInt(ctxBuffer.text, 10);

    // Spread the original model so fields without UI controls
    // (features, ...) survive an edit.
    const generateConfig = { ...model?.generateConfig };
    if (effort === 'default') {
      delete generateConfig.reasoningEffort;
    } else {
      generateConfig.reasoningEffort = effort;
    }

    const newModel: ProviderModel = {
      ...model,
      id,
      tier: tier === 'none' ? undefined : tier,
      contextWindow: !Number.isNaN(contextWindow) ? contextWindow : undefined,
      // Assign (instead of deleting) so the key stays present when cleared.
      // updateModel() folds patches in with a spread merge, so omitting the
      // key would silently keep the stale generateConfig (e.g. a previously
      // saved reasoningEffort) from the stored model.
      generateConfig:
        Object.keys(generateConfig).length > 0 ? generateConfig : undefined,
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
    <Box flexDirection="column" width="100%">
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
          <Text color={theme.text.secondary}>(Required, e.g. gemini-3.1-pro)</Text>
        </Text>
        <Box
          borderStyle="round"
          borderColor={focusField === 'id' ? theme.ui.focus : theme.border.default}
          paddingX={1}
        >
          <TextInput
            buffer={idBuffer}
            focus={focusField === 'id'}
            onSubmit={() => moveFocus(true)}
            onCancel={handleSaveAndExit}
          />
        </Box>
      </Box>

      {/* Model Tier Selection */}
      <InlineRadioGroup
        label="Model Tier:"
        hint="(Used for subagents, routing, and compression)"
        options={TIERS}
        value={tier}
        onChange={setTier}
        focus={focusField === 'tier'}
        onSubmit={() => moveFocus(true)}
      />

      {/* Reasoning Effort Selection */}
      <InlineRadioGroup
        label="Reasoning Effort:"
        hint="(none disables thinking)"
        options={EFFORTS}
        value={effort}
        onChange={setEffort}
        focus={focusField === 'reasoningEffort'}
        onSubmit={() => moveFocus(true)}
      />

      {/* Context Window */}
      <Box marginTop={1} flexDirection="column">
        <Text
          color={
            focusField === 'contextWindow' ? theme.text.accent : theme.text.primary
          }
          bold={focusField === 'contextWindow'}
        >
          Context Window
        </Text>
        <Box
          borderStyle="round"
          borderColor={
            focusField === 'contextWindow' ? theme.ui.focus : theme.border.default
          }
          paddingX={1}
        >
          <TextInput
            buffer={ctxBuffer}
            placeholder="Default 1m tokens"
            focus={focusField === 'contextWindow'}
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
          (↑/↓ or Tab to switch fields, ←/→ to toggle radio, Esc to save & return)
        </Text>
      </Box>
    </Box>
  );
}
