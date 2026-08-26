/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import type { ProviderModel, ProviderProfile } from 'sparkle-cli-core';
import { useKeypress } from '../hooks/useKeypress.js';
import { Command } from '../key/keyMatchers.js';
import { useKeyMatchers } from '../hooks/useKeyMatchers.js';
import { ProviderModelEditorView } from './ProviderModelEditorView.js';

export interface ProviderModelsViewProps {
  profile: ProviderProfile;
  onAddModel: (model: ProviderModel) => void | Promise<void>;
  onUpdateModel: (
    oldModelId: string,
    model: ProviderModel,
  ) => void | Promise<void>;
  onDeleteModel: (modelId: string) => void | Promise<void>;
  onSetDefaultModel: (modelId: string) => void | Promise<void>;
  onBack: () => void;
  error?: string | null;
}

export function ProviderModelsView({
  profile,
  onAddModel,
  onUpdateModel,
  onDeleteModel,
  onSetDefaultModel,
  onBack,
  error,
}: ProviderModelsViewProps): React.JSX.Element {
  const keyMatchers = useKeyMatchers();
  const models = profile.models || [];
  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (models.length === 0) return 0;
    const defaultIdx = models.findIndex((m) => m.id === profile.defaultModel);
    return defaultIdx >= 0 ? defaultIdx : 0;
  });
  const [isEditingModel, setIsEditingModel] = useState(false);
  const [editingModelTarget, setEditingModelTarget] = useState<
    ProviderModel | undefined
  >(undefined);

  const clampedIndex =
    models.length > 0 ? Math.min(selectedIndex, models.length - 1) : 0;
  const selectedModel = models[clampedIndex];

  const handleSaveModel = (newModel: ProviderModel) => {
    if (editingModelTarget) {
      void onUpdateModel(editingModelTarget.id, newModel);
    } else {
      void onAddModel(newModel);
    }
    setIsEditingModel(false);
    setEditingModelTarget(undefined);
  };

  const handleCancelEdit = () => {
    setIsEditingModel(false);
    setEditingModelTarget(undefined);
  };

  useKeypress(
    (key) => {
      if (isEditingModel) {
        return false;
      }

      if (models.length === 0) {
        if (keyMatchers[Command.RETURN](key) || key.name === 'a') {
          setEditingModelTarget(undefined);
          setIsEditingModel(true);
          return true;
        }
        if (keyMatchers[Command.ESCAPE](key)) {
          onBack();
          return true;
        }
        return false;
      }

      if (keyMatchers[Command.ESCAPE](key)) {
        onBack();
        return true;
      }
      if (key.name === 'up') {
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : models.length - 1));
        return true;
      }
      if (key.name === 'down') {
        setSelectedIndex((prev) => (prev < models.length - 1 ? prev + 1 : 0));
        return true;
      }
      if (key.name === 'a') {
        setEditingModelTarget(undefined);
        setIsEditingModel(true);
        return true;
      }
      if (
        (key.name === 's' || keyMatchers[Command.RETURN](key)) &&
        selectedModel
      ) {
        void onSetDefaultModel(selectedModel.id);
        return true;
      }
      if (key.name === 'e' && selectedModel) {
        setEditingModelTarget(selectedModel);
        setIsEditingModel(true);
        return true;
      }
      if (key.name === 'd' && selectedModel) {
        void onDeleteModel(selectedModel.id);
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  if (isEditingModel) {
    return (
      <ProviderModelEditorView
        model={editingModelTarget}
        onSave={handleSaveModel}
        onCancel={handleCancelEdit}
        error={error}
      />
    );
  }

  if (models.length === 0) {
    return (
      <Box flexDirection="column" width="100%">
        <Text bold color={theme.text.primary}>
          Models for: {profile.id}
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.secondary}>
            No models configured for this provider.
          </Text>
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color={theme.status.error}>{error}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            <Text color={theme.text.accent}>[a]</Text> Add model{'   '}
            <Text color={theme.text.secondary}>[Esc] Back</Text>
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Text bold color={theme.text.primary}>
        Models for: {profile.id}
      </Text>

      <Box marginTop={1} flexDirection="column">
        {models.map((model, idx) => {
          const isSelected = idx === clampedIndex;
          const isDefault = profile.defaultModel === model.id;
          const tierText = model.tier ? `tier: ${model.tier}` : 'no tier';

          return (
            <Box
              key={model.id}
              flexDirection="column"
              marginBottom={1}
              backgroundColor={isSelected ? theme.background.focus : undefined}
            >
              <Box flexDirection="row">
                <Text
                  bold={isSelected}
                  color={isSelected ? theme.status.success : theme.text.primary}
                >
                  {isDefault ? '● ' : '  '}
                  {model.id}
                </Text>
                {isDefault && (
                  <Box justifyContent="flex-end" flexGrow={1}>
                    <Text color={theme.status.success}>{'✓ Default'}</Text>
                  </Box>
                )}
              </Box>
              <Box marginLeft={2}>
                <Text color={theme.text.secondary}>{tierText}</Text>
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

      <Box marginTop={1}>
        <Text color={theme.text.secondary}>
          <Text color={theme.text.accent}>[a]</Text> Add model{'  '}
          <Text color={theme.text.accent}>[e]</Text> Edit{'  '}
          <Text color={theme.text.accent}>[s]</Text> Set default{'  '}
          <Text color={theme.text.accent}>[d]</Text> Delete{'  '}
          <Text color={theme.text.secondary}>[Esc] Back</Text>
        </Text>
      </Box>
    </Box>
  );
}
