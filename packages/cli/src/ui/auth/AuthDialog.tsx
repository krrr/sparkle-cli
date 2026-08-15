/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { RadioButtonSelect } from '../components/shared/RadioButtonSelect.js';
import { TextInput } from '../components/shared/TextInput.js';
import { useTextBuffer } from '../components/shared/text-buffer.js';
import { useUIState } from '../contexts/UIStateContext.js';
import {
  SettingScope,
  type LoadableSettingScope,
  type LoadedSettings,
} from '../../config/settings.js';
import {
  ProviderType,
  DEFAULT_OPENAI_BASE_URL,
  loadApiKey,
  saveApiKey,
} from 'sparkle-cli-core';
import { useKeypress } from '../hooks/useKeypress.js';
import { AuthState } from '../types.js';
import { validateAuthMethodWithSettings } from './useAuth.js';

interface AuthDialogProps {
  settings: LoadedSettings;
  setAuthState: (state: AuthState) => void;
  authError: string | null;
  onAuthError: (error: string | null) => void;
}

function getDefaultOpenAiBaseUrl(settings: LoadedSettings): string {
  return (
    settings.merged.security.auth.openaiBaseUrl ||
    process.env['OPENAI_BASE_URL'] ||
    DEFAULT_OPENAI_BASE_URL
  );
}

export function AuthDialog({
  settings,
  setAuthState,
  authError,
  onAuthError,
}: AuthDialogProps): React.JSX.Element {
  // The OpenAI option is always available, even when OPENAI_API_KEY is not
  // set, so users can point at local or custom OpenAI-compatible endpoints
  // (e.g. Ollama) that may not require an API key.
  const items = [
    {
      label: 'Use Gemini API',
      value: ProviderType.USE_GEMINI,
      key: ProviderType.USE_GEMINI,
    },
    {
      label: 'Use OpenAI-compatible API',
      value: ProviderType.USE_OPENAI,
      key: ProviderType.USE_OPENAI,
    },
  ];

  // When true, the dialog shows the OpenAI config form (base URL on top,
  // API key below) instead of the auth method radio list.
  const [isEnteringOpenAiConfig, setIsEnteringOpenAiConfig] = useState(false);
  // Tracks which input has focus while entering the OpenAI config. The base
  // URL input is focused first; submitting it moves focus to the API key.
  const [isBaseUrlFocused, setIsBaseUrlFocused] = useState(true);

  const { terminalWidth } = useUIState();
  const viewportWidth = terminalWidth - 8;

  const baseUrlBuffer = useTextBuffer({
    initialText: getDefaultOpenAiBaseUrl(settings),
    initialCursorOffset: getDefaultOpenAiBaseUrl(settings).length,
    viewport: {
      width: viewportWidth,
      height: 4,
    },
    singleLine: true,
  });

  const defaultOpenAiKey = process.env['OPENAI_API_KEY'] || '';
  const apiKeyBuffer = useTextBuffer({
    initialText: defaultOpenAiKey,
    initialCursorOffset: defaultOpenAiKey.length,
    viewport: {
      width: viewportWidth,
      height: 4,
    },
    // API keys are alphanumeric (plus a few separator characters), matching
    // the Gemini API key input behavior.
    inputFilter: (text) =>
      text.replace(/[^a-zA-Z0-9_.-]/g, '').replace(/[\r\n]/g, ''),
    singleLine: true,
  });

  let defaultAuthType: ProviderType | null = null;
  const defaultAuthTypeEnv = process.env['GEMINI_DEFAULT_AUTH_TYPE'];
  if (
    defaultAuthTypeEnv &&
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    Object.values(ProviderType).includes(defaultAuthTypeEnv as ProviderType)
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    defaultAuthType = defaultAuthTypeEnv as ProviderType;
  }

  const initialAuthIndex = items.findIndex((item) => {
    if (settings.merged.security.auth.selectedType) {
      return item.value === settings.merged.security.auth.selectedType;
    }

    if (defaultAuthType) {
      return item.value === defaultAuthType;
    }

    return item.value === ProviderType.USE_GEMINI;
  });

  const onSelect = useCallback(
    async (authType: ProviderType | undefined, scope: LoadableSettingScope) => {
      if (authType) {
        settings.setValue(scope, 'security.auth.selectedType', authType);

        if (authType === ProviderType.USE_GEMINI) {
          // Always show the API key input dialog so the user can
          // explicitly enter or confirm their key, regardless of
          // whether GEMINI_API_KEY env var or a stored key exists.
          setAuthState(AuthState.AwaitingApiKeyInput);
          return;
        }
      }
      setAuthState(AuthState.Unauthenticated);
    },
    [settings, setAuthState],
  );

  const handleAuthSelect = async (authMethod: ProviderType) => {
    const error = await validateAuthMethodWithSettings(
      authMethod,
      settings,
    ).catch((e) => (e instanceof Error ? e.message : String(e)));
    if (error) {
      onAuthError(error);
      return;
    }
    if (authMethod === ProviderType.USE_OPENAI) {
      // Ask for the base URL and API key before finalizing the selection so
      // they can be stored and used by the OpenAI-compatible content
      // generator. The base URL input is shown on top, the key below.
      onAuthError(null);
      setIsEnteringOpenAiConfig(true);
      setIsBaseUrlFocused(true);
      if (!process.env['OPENAI_API_KEY']) {
        const storedKey = await loadApiKey(ProviderType.USE_OPENAI);
        if (storedKey) {
          apiKeyBuffer.setText(storedKey);
        }
      }
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    onSelect(authMethod, SettingScope.User);
  };

  const handleOpenAiConfigCancel = () => {
    setIsEnteringOpenAiConfig(false);
    setIsBaseUrlFocused(true);
    onAuthError(null);
  };

  const handleBaseUrlSubmit = (baseUrl: string) => {
    const trimmed = baseUrl.trim();
    if (trimmed) {
      try {
        new URL(trimmed);
      } catch {
        onAuthError(`Invalid base URL: "${trimmed}".`);
        return;
      }
    }
    onAuthError(null);
    // Move focus to the API key input below.
    setIsBaseUrlFocused(false);
  };

  const handleOpenAiKeySubmit = async (apiKey: string) => {
    try {
      await saveApiKey(ProviderType.USE_OPENAI, apiKey.trim() || undefined);
      onAuthError(null);
      settings.setValue(
        SettingScope.User,
        'security.auth.openaiBaseUrl',
        baseUrlBuffer.text.trim() || undefined,
      );
      setIsEnteringOpenAiConfig(false);
      setIsBaseUrlFocused(true);
      await onSelect(ProviderType.USE_OPENAI, SettingScope.User);
    } catch (e) {
      onAuthError(
        `Failed to save API key: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        // Prevent exit if there is an error message.
        // This means they user is not authenticated yet.
        if (authError) {
          return true;
        }
        if (settings.merged.security.auth.selectedType === undefined) {
          // Prevent exiting if no auth method is set
          onAuthError(
            'You must select an auth method to proceed. Press Ctrl+C twice to exit.',
          );
          return true;
        }
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        onSelect(undefined, SettingScope.User);
        return true;
      }
      return false;
    },
    { isActive: !isEnteringOpenAiConfig },
  );

  return (
    <Box
      borderStyle="round"
      borderColor={theme.ui.focus}
      flexDirection="row"
      padding={1}
      width="100%"
      alignItems="flex-start"
    >
      <Text color={theme.text.accent}>? </Text>
      <Box flexDirection="column" flexGrow={1}>
        {isEnteringOpenAiConfig ? (
          <>
            <Text bold color={theme.text.primary}>
              Configure OpenAI-compatible API
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.text.primary}>Base URL</Text>
              <Text color={theme.text.secondary}>
                Enter the base URL of your API endpoint. For example:{' '}
                <Text color={theme.text.link}>{DEFAULT_OPENAI_BASE_URL}</Text>{' '}
                (Official) or http://localhost:11434/v1 (Ollama)
              </Text>
            </Box>
            <Box marginTop={1} flexDirection="row">
              <Box
                borderStyle="round"
                borderColor={theme.border.default}
                paddingX={1}
                flexGrow={1}
              >
                <TextInput
                  buffer={baseUrlBuffer}
                  onSubmit={handleBaseUrlSubmit}
                  onCancel={handleOpenAiConfigCancel}
                  placeholder={DEFAULT_OPENAI_BASE_URL}
                  focus={isBaseUrlFocused}
                />
              </Box>
            </Box>
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.text.primary}>API Key</Text>
              <Text color={theme.text.secondary}>
                Optional for local or custom endpoints that do not require
                authentication. When provided, it is securely stored in your
                system keychain.
              </Text>
            </Box>
            <Box marginTop={1} flexDirection="row">
              <Box
                borderStyle="round"
                borderColor={theme.border.default}
                paddingX={1}
                flexGrow={1}
              >
                <TextInput
                  buffer={apiKeyBuffer}
                  onSubmit={handleOpenAiKeySubmit}
                  onCancel={handleOpenAiConfigCancel}
                  placeholder="Paste your API key here (optional)"
                  focus={!isBaseUrlFocused}
                />
              </Box>
            </Box>
            {authError && (
              <Box marginTop={1}>
                <Text color={theme.status.error}>{authError}</Text>
              </Box>
            )}
            <Box marginTop={1}>
              <Text color={theme.text.secondary}>
                (Press Enter to submit, Esc to cancel)
              </Text>
            </Box>
          </>
        ) : (
          <>
            <Text bold color={theme.text.primary}>
              Get started
            </Text>
            <Box marginTop={1}>
              <Text color={theme.text.primary}>
                Which kind of LLM provider would you like to use?
              </Text>
            </Box>
            <Box marginTop={1}>
              <RadioButtonSelect
                items={items}
                initialIndex={initialAuthIndex}
                onSelect={handleAuthSelect}
                onHighlight={() => {
                  onAuthError(null);
                }}
              />
            </Box>
            {authError && (
              <Box marginTop={1}>
                <Text color={theme.status.error}>{authError}</Text>
              </Box>
            )}
            <Box marginTop={1}>
              <Text color={theme.text.secondary}>(Use Enter to select)</Text>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
