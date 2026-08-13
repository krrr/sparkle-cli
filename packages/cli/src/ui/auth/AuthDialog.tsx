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
import { AuthType, DEFAULT_OPENAI_BASE_URL } from 'sparkle-cli-core';
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
      label: 'Use Gemini API Key',
      value: AuthType.USE_GEMINI,
      key: AuthType.USE_GEMINI,
    },
    {
      label: 'Use OpenAI-compatible API Key',
      value: AuthType.USE_OPENAI,
      key: AuthType.USE_OPENAI,
    },
  ];

  const filteredItems = settings.merged.security.auth.enforcedType
    ? items.filter(
        (item) => item.value === settings.merged.security.auth.enforcedType,
      )
    : items;

  // When true, the dialog shows a base URL input for the OpenAI option
  // instead of the auth method radio list.
  const [isEnteringBaseUrl, setIsEnteringBaseUrl] = useState(false);

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

  let defaultAuthType: AuthType | null = null;
  const defaultAuthTypeEnv = process.env['GEMINI_DEFAULT_AUTH_TYPE'];
  if (
    defaultAuthTypeEnv &&
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    Object.values(AuthType).includes(defaultAuthTypeEnv as AuthType)
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    defaultAuthType = defaultAuthTypeEnv as AuthType;
  }

  let initialAuthIndex = filteredItems.findIndex((item) => {
    if (settings.merged.security.auth.selectedType) {
      return item.value === settings.merged.security.auth.selectedType;
    }

    if (defaultAuthType) {
      return item.value === defaultAuthType;
    }

    return item.value === AuthType.USE_GEMINI;
  });
  if (settings.merged.security.auth.enforcedType) {
    initialAuthIndex = 0;
  }

  const onSelect = useCallback(
    async (authType: AuthType | undefined, scope: LoadableSettingScope) => {
      if (authType) {
        settings.setValue(scope, 'security.auth.selectedType', authType);

        if (authType === AuthType.USE_GEMINI) {
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

  const handleAuthSelect = async (authMethod: AuthType) => {
    const error = await validateAuthMethodWithSettings(
      authMethod,
      settings,
    ).catch((e) => (e instanceof Error ? e.message : String(e)));
    if (error) {
      onAuthError(error);
      return;
    }
    if (authMethod === AuthType.USE_OPENAI) {
      // Ask for the base URL before finalizing the selection so it can be
      // stored and used by the OpenAI-compatible content generator.
      onAuthError(null);
      setIsEnteringBaseUrl(true);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    onSelect(authMethod, SettingScope.User);
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
    settings.setValue(
      SettingScope.User,
      'security.auth.openaiBaseUrl',
      trimmed || undefined,
    );
    setIsEnteringBaseUrl(false);
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    onSelect(AuthType.USE_OPENAI, SettingScope.User);
  };

  const handleBaseUrlCancel = () => {
    setIsEnteringBaseUrl(false);
    onAuthError(null);
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
    { isActive: !isEnteringBaseUrl },
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
        {isEnteringBaseUrl ? (
          <>
            <Text bold color={theme.text.primary}>
              Enter OpenAI-compatible Base URL
            </Text>
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.text.primary}>
                Enter the base URL of your OpenAI-compatible API endpoint.
              </Text>
              <Text color={theme.text.secondary}>
                For example:{' '}
                <Text color={theme.text.link}>{DEFAULT_OPENAI_BASE_URL}</Text>{' '}
                or a local endpoint such as http://localhost:11434/v1
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
                  onCancel={handleBaseUrlCancel}
                  placeholder={DEFAULT_OPENAI_BASE_URL}
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
                Which LLM provider would you like to use?
              </Text>
            </Box>
            <Box marginTop={1}>
              <RadioButtonSelect
                items={filteredItems}
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
