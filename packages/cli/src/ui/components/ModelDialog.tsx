/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useContext, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import {
  SPARKLE_MODEL_ALIAS_AUTO,
  ModelSlashCommandEvent,
  logModelSlashCommand,
  getDisplayString,
} from 'sparkle-cli-core';
import { useKeypress } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import { DescriptiveRadioButtonSelect } from './shared/DescriptiveRadioButtonSelect.js';
import { ConfigContext } from '../contexts/ConfigContext.js';

interface ModelDialogProps {
  onClose: () => void;
}

export function ModelDialog({ onClose }: ModelDialogProps): React.JSX.Element {
  const config = useContext(ConfigContext);
  const [persistMode, setPersistMode] = useState(false);

  const profileService = config?.getProviderProfileService();
  const activeProfile = profileService?.getActiveProfile();

  // Determine current preferred model
  const preferredModel =
    config?.getModel() ||
    activeProfile?.defaultModel ||
    SPARKLE_MODEL_ALIAS_AUTO;

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onClose();
        return true;
      }
      if (key.name === 'tab') {
        setPersistMode((prev) => !prev);
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  const options = useMemo(() => {
    if (activeProfile) {
      if (!activeProfile.models || activeProfile.models.length === 0) {
        return [];
      }

      const isAutoDefault =
        activeProfile.defaultModel === SPARKLE_MODEL_ALIAS_AUTO;
      const autoOption = {
        value: SPARKLE_MODEL_ALIAS_AUTO,
        title: 'Auto',
        description:
          (isAutoDefault ? 'remembered, ' : '') +
          'auto routing based on model tier',
        key: SPARKLE_MODEL_ALIAS_AUTO,
      };

      const profileModelOptions = activeProfile.models.map((m) => {
        const isDefault = activeProfile.defaultModel === m.id;
        const tierStr = m.tier ? `tier: ${m.tier}` : '';
        const desc = [isDefault ? 'remembered' : '', tierStr]
          .filter(Boolean)
          .join(', ');

        return {
          value: m.id,
          title: m.id,
          description: desc,
          key: m.id,
        };
      });

      return [autoOption, ...profileModelOptions];
    }

    if (!config?.getModelConfigService) {
      return [];
    }

    const allOptions = config
      .getModelConfigService()
      .getAvailableModelOptions({});

    return allOptions
      .filter((o) => o.tier !== 'auto')
      .map((o) => ({
        value: o.modelId,
        title: o.name || getDisplayString(o.modelId, config ?? undefined),
        description: o.description,
        key: o.modelId,
      }));
  }, [config, activeProfile]);

  const initialIndex = useMemo(() => {
    if (preferredModel === SPARKLE_MODEL_ALIAS_AUTO) {
      return 0;
    }
    let idx = options.findIndex((option) => option.value === preferredModel);
    if (idx === -1 && activeProfile?.models) {
      const matchingModel = activeProfile.models.find(
        (m) => m.tier === preferredModel,
      );
      if (matchingModel) {
        idx = options.findIndex((option) => option.value === matchingModel.id);
      }
    }
    return idx !== -1 ? idx : 0;
  }, [preferredModel, options, activeProfile]);

  const handleSelect = useCallback(
    async (model: string) => {
      if (config) {
        if (persistMode && activeProfile && profileService) {
          await profileService.setDefaultModel(activeProfile.id, model);
        }
        config.setModel(model, !persistMode);
        const event = new ModelSlashCommandEvent(model);
        logModelSlashCommand(config, event);
      }
      onClose();
    },
    [config, activeProfile, profileService, onClose, persistMode],
  );

  if (!activeProfile && options.length === 0) {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.border.default}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold>Select Model</Text>
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            No active provider configured. Use /provider to configure a
            provider.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>(Press Esc to close)</Text>
        </Box>
      </Box>
    );
  }

  if (activeProfile && options.length === 0) {
    return (
      <Box
        borderStyle="round"
        borderColor={theme.border.default}
        flexDirection="column"
        padding={1}
        width="100%"
      >
        <Text bold>Select Model</Text>
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>
            {`No models configured for provider "${activeProfile.id}". Use /provider to add models.`}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.text.secondary}>(Press Esc to close)</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>
        Select Model {activeProfile ? `(${activeProfile.id})` : ''}
      </Text>

      <Box marginTop={1}>
        <DescriptiveRadioButtonSelect
          items={options}
          onSelect={(val) => void handleSelect(val)}
          initialIndex={initialIndex}
          showNumbers={true}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text bold color={theme.text.primary}>
            Remember model for future sessions:{' '}
          </Text>
          <Text color={theme.status.success}>
            {persistMode ? 'true' : 'false'}
          </Text>
          <Text color={theme.text.secondary}> (Press Tab to toggle)</Text>
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.secondary}>(Press Esc to close)</Text>
      </Box>
    </Box>
  );
}
