/**
 * @license
 * Copyright 2026 krrr
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import {
  DEFAULT_OPENAI_BASE_URL,
  OpenAiApiError,
  OpenAiCompatibleGenerator,
  loadApiKeyForProfile,
  type ProviderModel,
  type ProviderProfile,
} from 'sparkle-cli-core';
import { BaseSelectionList } from '../components/shared/BaseSelectionList.js';
import { CliSpinner } from '../components/CliSpinner.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { Command } from '../key/keyMatchers.js';
import { useKeyMatchers } from '../hooks/useKeyMatchers.js';
import { KeypressPriority } from '../contexts/KeypressContext.js';

export interface ProviderModelFetchViewProps {
  profile: ProviderProfile;
  /** Ids of models already present in the profile, marked with "✓ Added". */
  existingModelIds: string[];
  onAddModel: (model: ProviderModel) => void | Promise<void>;
  onBack: () => void;
  /** Persistence errors surfaced by the host view (e.g. addModel failures). */
  error?: string | null;
}

type FetchState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'loaded'; models: string[] };

const LIST_TIMEOUT_MS = 15_000;
const MAX_ITEMS_TO_SHOW = 15; // Maximum items in scroll list

function describeFetchError(error: unknown): string {
  if (error instanceof OpenAiApiError) {
    if (error.status === 401 || error.status === 403) {
      return `Failed to fetch models: ${error.message}. Check the API key configured for this provider.`;
    } else if (error.status === 404) {
      return `Failed to fetch models: ${error.message}. The endpoint may not support the /models API.`;
    }
    return `Failed to fetch models: ${error.message}`;
  }
  return `Failed to fetch models: ${error instanceof Error ? error.message : String(error)}`;
}

export function ProviderModelFetchView({
  profile,
  existingModelIds,
  onAddModel,
  onBack,
  error,
}: ProviderModelFetchViewProps): React.JSX.Element {
  const keyMatchers = useKeyMatchers();
  const baseUrl = profile.baseUrl || DEFAULT_OPENAI_BASE_URL;

  const [fetchState, setFetchState] = useState<FetchState>({ phase: 'loading' });
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const existingIdsRef = useRef(existingModelIds);
  existingIdsRef.current = existingModelIds;
  const justAddedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchModels = useCallback(async () => {
    setFetchState({ phase: 'loading' });
    setJustAddedId(null);
    try {
      const apiKey =
        process.env['OPENAI_API_KEY'] || (await loadApiKeyForProfile(profile.id)) || '';
      if (!apiKey) {
        setFetchState({
          phase: 'error',
          message:
            'No API key found for this provider. Set OPENAI_API_KEY or re-enter the key in the provider settings.',
        });
        return;
      }
      const generator = new OpenAiCompatibleGenerator({
        apiKey,
        baseUrl,
        provider: 'custom',
        proxy: undefined,
      });
      const models = await Promise.race([
        generator.listModels(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Request timed out.')), LIST_TIMEOUT_MS),
        ),
      ]);
      // APIs return models in arbitrary order; sort for a predictable list.
      setFetchState({
        phase: 'loaded',
        models: models.sort((a, b) => a.localeCompare(b)),
      });
    } catch (e) {
      setFetchState({ phase: 'error', message: describeFetchError(e) });
    }
  }, [baseUrl, profile.id]);

  useEffect(() => {
    // fetchModels never rejects: all failure paths set the error state.
    void fetchModels();
  }, [fetchModels]);

  useEffect(
    () => () => {
      if (justAddedTimerRef.current) {
        clearTimeout(justAddedTimerRef.current);
      }
    },
    [],
  );

  const models = fetchState.phase === 'loaded' ? fetchState.models : [];
  const hasModels = models.length > 0;

  const items = models.map((modelId) => ({ key: modelId, value: modelId }));

  const handleSelect = (modelId: string) => {
    if (existingIdsRef.current.includes(modelId)) {
      // Surface the duplicate instead of calling the upserting addModel.
      setJustAddedId(modelId);
      if (justAddedTimerRef.current) {
        clearTimeout(justAddedTimerRef.current);
      }
      justAddedTimerRef.current = setTimeout(() => setJustAddedId(null), 2000);
      return;
    }
    void onAddModel({ id: modelId });
  };

  // Runs at high priority so Esc/retry works in every phase. The list itself
  // (only mounted while models are loaded) handles up/down/Enter at normal
  // priority; unconsumed keys fall through to it.
  useKeypress(
    (key) => {
      if (keyMatchers[Command.ESCAPE](key)) {
        onBack();
        return true;
      } else if (key.name === 'r') {
        void fetchModels();
        return true;
      }
      return false;
    },
    { isActive: true, priority: KeypressPriority.High },
  );

  return (
    <Box flexDirection="column" width="100%">
      <Text bold color={theme.text.primary}>
        Models from API: {baseUrl}
      </Text>

      {fetchState.phase === 'loading' && (
        <Box marginTop={1} flexDirection="row" gap={1}>
          <CliSpinner type="dots" />
          <Text color={theme.text.secondary}>Fetching models...</Text>
        </Box>
      )}

      {fetchState.phase === 'error' && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.status.error}>{fetchState.message}</Text>
          <Box marginTop={1}>
            <Text color={theme.text.secondary}>
              <Text color={theme.text.accent}>[r]</Text> Retry{'  '}
              <Text color={theme.text.secondary}>[Esc] Back</Text>
            </Text>
          </Box>
        </Box>
      )}

      {fetchState.phase === 'loaded' && !hasModels && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.text.secondary}>The API returned no models.</Text>
          <Box marginTop={1}>
            <Text color={theme.text.secondary}>
              <Text color={theme.text.accent}>[r]</Text> Retry{'  '}
              <Text color={theme.text.secondary}>[Esc] Back</Text>
            </Text>
          </Box>
        </Box>
      )}

      {fetchState.phase === 'loaded' && hasModels && (
        <Box marginTop={1} flexDirection="column">
          <BaseSelectionList
            items={items}
            onSelect={handleSelect}
            showNumbers={false}
            showScrollArrows
            maxItemsToShow={MAX_ITEMS_TO_SHOW}
            selectedIndicator="❯"
            renderItem={(item, { isSelected, titleColor }) => (
              <Box flexGrow={1}>
                <Text bold={isSelected} color={titleColor}>
                  {item.value}
                </Text>
                {existingModelIds.includes(item.value) && (
                  <Box flexGrow={1} justifyContent="flex-end">
                    <Text color={theme.status.success}>✓ Added</Text>
                  </Box>
                )}
              </Box>
            )}
          />

          {error && (
            <Box marginTop={1}>
              <Text color={theme.status.error}>{error}</Text>
            </Box>
          )}

          {justAddedId && (
            <Box marginTop={1}>
              <Text color={theme.status.warning}>{justAddedId} is already added.</Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text color={theme.text.secondary}>
              <Text color={theme.text.accent}>[Enter]</Text> Add model{'  '}
              <Text color={theme.text.accent}>[r]</Text> Refresh{'  '}
              <Text color={theme.text.secondary}>[Esc] Back</Text>
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
