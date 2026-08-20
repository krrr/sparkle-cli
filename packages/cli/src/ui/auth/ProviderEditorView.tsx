/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import {
  ProviderType,
  DEFAULT_OPENAI_BASE_URL,
  type ProviderProfile,
  loadApiKeyForProfile,
} from 'sparkle-cli-core';
import { TextInput } from '../components/shared/TextInput.js';
import { useTextBuffer } from '../components/shared/text-buffer.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { Command } from '../key/keyMatchers.js';
import { useKeyMatchers } from '../hooks/useKeyMatchers.js';

export interface ProviderEditorViewProps {
  profile?: ProviderProfile; // undefined if creating new
  onSave: (
    data: {
      id?: string;
      providerType: ProviderType;
      baseUrl?: string;
    },
    apiKey: string,
  ) => void | Promise<void>;
  onCancel: () => void;
  error?: string | null;
}

type FocusField = 'id' | 'type' | 'baseUrl' | 'apiKey';

export function ProviderEditorView({
  profile,
  onSave,
  onCancel,
  error,
}: ProviderEditorViewProps): React.JSX.Element {
  const keyMatchers = useKeyMatchers();
  const isEditing = !!profile;
  const [providerType, setProviderType] = useState<ProviderType>(
    profile?.providerType || ProviderType.USE_GEMINI,
  );
  const [focusField, setFocusField] = useState<FocusField>('id');

  const { terminalWidth } = useUIState();
  const viewportWidth = Math.max(40, terminalWidth - 12);

  const idBuffer = useTextBuffer({
    initialText:
      profile?.id ||
      (providerType === ProviderType.USE_GEMINI ? 'gemini' : 'openai'),
    initialCursorOffset: (
      profile?.id ||
      (providerType === ProviderType.USE_GEMINI ? 'gemini' : 'openai')
    ).length,
    viewport: { width: viewportWidth, height: 1 },
    inputFilter: (text) =>
      text.replace(/[^a-zA-Z0-9_-]/g, '').replace(/[\r\n]/g, ''),
    singleLine: true,
  });

  const baseUrlBuffer = useTextBuffer({
    initialText:
      profile?.baseUrl ||
      (providerType === ProviderType.USE_OPENAI ? DEFAULT_OPENAI_BASE_URL : ''),
    initialCursorOffset: (
      profile?.baseUrl ||
      (providerType === ProviderType.USE_OPENAI ? DEFAULT_OPENAI_BASE_URL : '')
    ).length,
    viewport: { width: viewportWidth, height: 1 },
    singleLine: true,
  });

  const [initialApiKey, setInitialApiKey] = useState('');
  const apiKeyBuffer = useTextBuffer({
    initialText: initialApiKey,
    initialCursorOffset: initialApiKey.length,
    viewport: { width: viewportWidth, height: 1 },
    inputFilter: (text) => text.replace(/[\r\n]/g, ''),
    singleLine: true,
  });

  useEffect(() => {
    if (!profile) return;
    void (async () => {
      const key = await loadApiKeyForProfile(profile.id);
      if (key) {
        setInitialApiKey(key);
        apiKeyBuffer.setText(key);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const fields: FocusField[] = ['id', 'type', 'baseUrl', 'apiKey'];

  const moveFocus = (forward: boolean) => {
    const currentIdx = fields.indexOf(focusField);
    if (currentIdx === -1) {
      setFocusField(fields[0]);
      return;
    }
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
    const baseUrl = baseUrlBuffer.text.trim() || undefined;
    let apiKey = apiKeyBuffer.text.trim();
    if (
      (apiKey.startsWith('"') && apiKey.endsWith('"')) ||
      (apiKey.startsWith("'") && apiKey.endsWith("'"))
    ) {
      apiKey = apiKey.slice(1, -1).trim();
    }

    void onSave(
      {
        id,
        providerType,
        baseUrl,
      },
      apiKey,
    );
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
      if (focusField === 'type') {
        if (
          key.name === 'left' ||
          key.name === 'right' ||
          key.name === 'space'
        ) {
          const nextType =
            providerType === ProviderType.USE_GEMINI
              ? ProviderType.USE_OPENAI
              : ProviderType.USE_GEMINI;
          setProviderType(nextType);
          if (!isEditing && !idBuffer.text.trim()) {
            idBuffer.setText(
              nextType === ProviderType.USE_GEMINI ? 'gemini' : 'openai',
            );
          }
          if (
            nextType === ProviderType.USE_OPENAI &&
            !baseUrlBuffer.text.trim()
          ) {
            baseUrlBuffer.setText(DEFAULT_OPENAI_BASE_URL);
          }
          return true;
        }
        if (keyMatchers[Command.RETURN](key)) {
          setFocusField('baseUrl');
          return true;
        }
      }
      return false;
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column" width="100%">
      <Text bold color={theme.text.primary}>
        {isEditing ? `Edit Provider: ${profile.id}` : 'Add New Provider'}
      </Text>

      {/* ID Input */}
      <Box marginTop={1} flexDirection="column">
        <Text
          color={focusField === 'id' ? theme.text.accent : theme.text.primary}
          bold={focusField === 'id'}
        >
          Provider ID:
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
            placeholder="e.g. gemini-personal or openai-work"
            focus={focusField === 'id'}
            onSubmit={() => setFocusField('type')}
            onCancel={handleSaveAndExit}
          />
        </Box>
      </Box>

      {/* Provider Type Selection */}
      <Box marginTop={1} flexDirection="column">
        <Text
          color={focusField === 'type' ? theme.text.accent : theme.text.primary}
          bold={focusField === 'type'}
        >
          Provider Type: <Text color={theme.text.secondary}></Text>
        </Text>
        <Box flexDirection="row" marginTop={1}>
          <Box marginRight={2}>
            <Text
              color={
                providerType === ProviderType.USE_GEMINI
                  ? theme.status.success
                  : theme.text.secondary
              }
            >
              {providerType === ProviderType.USE_GEMINI ? '[●] ' : '[ ] '}
              Gemini
            </Text>
          </Box>
          <Box>
            <Text
              color={
                providerType === ProviderType.USE_OPENAI
                  ? theme.status.success
                  : theme.text.secondary
              }
            >
              {providerType === ProviderType.USE_OPENAI ? '[●] ' : '[ ] '}
              OpenAI-compatible
            </Text>
          </Box>
        </Box>
      </Box>

      {/* Base URL Input */}
      <Box marginTop={1} flexDirection="column">
        <Text
          color={
            focusField === 'baseUrl' ? theme.text.accent : theme.text.primary
          }
          bold={focusField === 'baseUrl'}
        >
          Base URL:{' '}
          <Text color={theme.text.secondary}>
            (optional for Gemini, default for OpenAI)
          </Text>
        </Text>
        <Box
          borderStyle="round"
          borderColor={
            focusField === 'baseUrl' ? theme.ui.focus : theme.border.default
          }
          paddingX={1}
        >
          <TextInput
            buffer={baseUrlBuffer}
            placeholder={
              providerType === ProviderType.USE_OPENAI
                ? DEFAULT_OPENAI_BASE_URL
                : 'https://generativelanguage.googleapis.com'
            }
            focus={focusField === 'baseUrl'}
            onSubmit={() => setFocusField('apiKey')}
            onCancel={handleSaveAndExit}
          />
        </Box>
      </Box>

      {/* API Key Input */}
      <Box marginTop={1} flexDirection="column">
        <Text
          color={
            focusField === 'apiKey' ? theme.text.accent : theme.text.primary
          }
          bold={focusField === 'apiKey'}
        >
          API Key:{' '}
          <Text color={theme.text.secondary}>
            (optional, leave empty to use environment variable)
          </Text>
        </Text>
        <Box
          borderStyle="round"
          borderColor={
            focusField === 'apiKey' ? theme.ui.focus : theme.border.default
          }
          paddingX={1}
        >
          <TextInput
            buffer={apiKeyBuffer}
            placeholder={
              providerType === ProviderType.USE_GEMINI
                ? 'Leave empty for GEMINI_API_KEY'
                : 'Leave empty for OPENAI_API_KEY'
            }
            focus={focusField === 'apiKey'}
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

      {/* Help text */}
      <Box marginTop={1}>
        <Text color={theme.text.secondary}>
          (↑/↓ or Tab to switch fields, ←/→ to toggle type, Esc to save &
          return)
        </Text>
      </Box>
    </Box>
  );
}
