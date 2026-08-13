/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { act } from 'react';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { AuthDialog } from './AuthDialog.js';
import { AuthType, DEFAULT_OPENAI_BASE_URL } from 'sparkle-cli-core';
import type { LoadedSettings } from '../../config/settings.js';
import { AuthState } from '../types.js';
import { RadioButtonSelect } from '../components/shared/RadioButtonSelect.js';
import { useKeypress } from '../hooks/useKeypress.js';
import {
  useTextBuffer,
  type TextBuffer,
} from '../components/shared/text-buffer.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { validateAuthMethodWithSettings } from './useAuth.js';
import { Text } from 'ink';

// Mocks
vi.mock('./useAuth.js', () => ({
  validateAuthMethodWithSettings: vi.fn(),
}));

vi.mock('../hooks/useKeypress.js', () => ({
  useKeypress: vi.fn(),
}));

vi.mock('../components/shared/RadioButtonSelect.js', () => ({
  RadioButtonSelect: vi.fn(({ items, initialIndex }) => (
    <>
      {items.map((item: { value: string; label: string }, index: number) => (
        <Text key={item.value}>
          {index === initialIndex ? '(selected)' : '(not selected)'}{' '}
          {item.label}
        </Text>
      ))}
    </>
  )),
}));

vi.mock('../components/shared/text-buffer.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../components/shared/text-buffer.js')
    >();
  return {
    ...actual,
    useTextBuffer: vi.fn(),
  };
});

vi.mock('../contexts/UIStateContext.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../contexts/UIStateContext.js')>();
  return {
    ...actual,
    useUIState: vi.fn(() => ({
      terminalWidth: 80,
    })),
  };
});

const mockedUseKeypress = useKeypress as Mock;
const mockedRadioButtonSelect = RadioButtonSelect as Mock;
const mockedValidateAuthMethod = validateAuthMethodWithSettings as Mock;
const mockedUseTextBuffer = useTextBuffer as Mock;
const mockedUseUIState = useUIState as Mock;

describe('AuthDialog', () => {
  let props: {
    settings: LoadedSettings;
    setAuthState: (state: AuthState) => void;
    authError: string | null;
    onAuthError: (error: string | null) => void;
  };
  let mockBuffer: TextBuffer;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('GEMINI_DEFAULT_AUTH_TYPE', undefined as unknown as string);
    vi.stubEnv('GEMINI_API_KEY', undefined as unknown as string);
    vi.stubEnv('OPENAI_API_KEY', undefined as unknown as string);
    vi.stubEnv('OPENAI_BASE_URL', undefined as unknown as string);
    mockedUseUIState.mockReturnValue({ terminalWidth: 80 });

    mockBuffer = {
      text: DEFAULT_OPENAI_BASE_URL,
      lines: [DEFAULT_OPENAI_BASE_URL],
      cursor: [0, DEFAULT_OPENAI_BASE_URL.length],
      visualCursor: [0, DEFAULT_OPENAI_BASE_URL.length],
      visualScrollRow: 0,
      viewportVisualLines: [DEFAULT_OPENAI_BASE_URL],
      pastedContent: {},
      handleInput: vi.fn(),
      setText: vi.fn((newText: string) => {
        mockBuffer.text = newText;
        mockBuffer.viewportVisualLines = [newText];
      }),
    } as unknown as TextBuffer;
    mockedUseTextBuffer.mockReturnValue(mockBuffer);

    props = {
      settings: {
        merged: {
          security: {
            auth: {},
          },
        },
        setValue: vi.fn(),
      } as unknown as LoadedSettings,
      setAuthState: vi.fn(),
      authError: null,
      onAuthError: vi.fn(),
    };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders Gemini and OpenAI options even without OPENAI_API_KEY set', async () => {
    const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
    const items = mockedRadioButtonSelect.mock.calls[0][0].items;
    expect(items).toHaveLength(2);
    expect(items[0].value).toBe(AuthType.USE_GEMINI);
    expect(items[0].label).toBe('Use Gemini API Key');
    expect(items[1].value).toBe(AuthType.USE_OPENAI);
    expect(items[1].label).toBe('Use OpenAI-compatible API Key');
    unmount();
  });

  it('filters auth types when enforcedType is set', async () => {
    props.settings.merged.security.auth.enforcedType = AuthType.USE_GEMINI;
    const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
    const items = mockedRadioButtonSelect.mock.calls[0][0].items;
    expect(items).toHaveLength(1);
    expect(items[0].value).toBe(AuthType.USE_GEMINI);
    unmount();
  });

  it('sets initial index to 0 when enforcedType is set', async () => {
    props.settings.merged.security.auth.enforcedType = AuthType.USE_GEMINI;
    const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
    const { initialIndex } = mockedRadioButtonSelect.mock.calls[0][0];
    expect(initialIndex).toBe(0);
    unmount();
  });

  describe('Initial Auth Type Selection', () => {
    it.each([
      {
        setup: () => {
          props.settings.merged.security.auth.selectedType =
            AuthType.USE_GEMINI;
        },
        expected: AuthType.USE_GEMINI,
        desc: 'from settings',
      },
      {
        setup: () => {
          vi.stubEnv('GEMINI_DEFAULT_AUTH_TYPE', AuthType.USE_GEMINI);
        },
        expected: AuthType.USE_GEMINI,
        desc: 'from GEMINI_DEFAULT_AUTH_TYPE env var',
      },
      {
        setup: () => {
          vi.stubEnv('GEMINI_API_KEY', 'test-key');
        },
        expected: AuthType.USE_GEMINI,
        desc: 'from GEMINI_API_KEY env var',
      },
      {
        setup: () => {},
        expected: AuthType.USE_GEMINI,
        desc: 'defaults to Gemini API key',
      },
    ])('selects initial auth type $desc', async ({ setup, expected }) => {
      setup();
      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      const { items, initialIndex } = mockedRadioButtonSelect.mock.calls[0][0];
      expect(items[initialIndex].value).toBe(expected);
      unmount();
    });
  });

  describe('handleAuthSelect', () => {
    it('calls onAuthError if validation fails', async () => {
      mockedValidateAuthMethod.mockResolvedValue('Invalid method');
      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(AuthType.USE_GEMINI);

      expect(mockedValidateAuthMethod).toHaveBeenCalledWith(
        AuthType.USE_GEMINI,
        props.settings,
      );
      expect(props.onAuthError).toHaveBeenCalledWith('Invalid method');
      expect(props.settings.setValue).not.toHaveBeenCalled();
      unmount();
    });

    it('shows API key input dialog on selection', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(AuthType.USE_GEMINI);

      expect(props.settings.setValue).toHaveBeenCalledWith(
        expect.any(String),
        'security.auth.selectedType',
        AuthType.USE_GEMINI,
      );
      expect(props.setAuthState).toHaveBeenCalledWith(
        AuthState.AwaitingApiKeyInput,
      );
      unmount();
    });

    it('always shows API key dialog even when env var is present', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      vi.stubEnv('GEMINI_API_KEY', 'test-key-from-env');
      // props.settings.merged.security.auth.selectedType is undefined here, simulating initial setup

      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(AuthType.USE_GEMINI);

      expect(props.setAuthState).toHaveBeenCalledWith(
        AuthState.AwaitingApiKeyInput,
      );
      unmount();
    });

    it('always shows API key dialog even when env var is empty string', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      vi.stubEnv('GEMINI_API_KEY', ''); // Empty string
      // props.settings.merged.security.auth.selectedType is undefined here

      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(AuthType.USE_GEMINI);

      expect(props.setAuthState).toHaveBeenCalledWith(
        AuthState.AwaitingApiKeyInput,
      );
      unmount();
    });

    it('shows API key dialog on initial setup if no env var is present', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      // process.env['GEMINI_API_KEY'] is not set
      // props.settings.merged.security.auth.selectedType is undefined here, simulating initial setup

      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(AuthType.USE_GEMINI);

      expect(props.setAuthState).toHaveBeenCalledWith(
        AuthState.AwaitingApiKeyInput,
      );
      unmount();
    });

    it('always shows API key dialog on re-auth even if env var is present', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      vi.stubEnv('GEMINI_API_KEY', 'test-key-from-env');
      // Simulate switching from a different auth method (e.g., Gateway → API key)
      props.settings.merged.security.auth.selectedType = AuthType.GATEWAY;

      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(AuthType.USE_GEMINI);

      expect(props.setAuthState).toHaveBeenCalledWith(
        AuthState.AwaitingApiKeyInput,
      );
      unmount();
    });
  });

  describe('OpenAI base URL flow', () => {
    it('shows the base URL input when OpenAI is selected', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      const { lastFrame, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(AuthType.USE_OPENAI);

      await waitFor(() => {
        expect(lastFrame()).toContain('Enter OpenAI-compatible Base URL');
      });
      // Selection is not finalized until the base URL is submitted.
      expect(props.settings.setValue).not.toHaveBeenCalled();
      expect(props.setAuthState).not.toHaveBeenCalled();
      unmount();
    });

    it('pre-fills the base URL input with the default OpenAI URL', async () => {
      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      expect(mockedUseTextBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          initialText: DEFAULT_OPENAI_BASE_URL,
        }),
      );
      unmount();
    });

    it('pre-fills the base URL input from the OPENAI_BASE_URL env var', async () => {
      vi.stubEnv('OPENAI_BASE_URL', 'https://env.example.com/v1');
      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      expect(mockedUseTextBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          initialText: 'https://env.example.com/v1',
        }),
      );
      unmount();
    });

    it('prefers a stored base URL setting over the env var', async () => {
      vi.stubEnv('OPENAI_BASE_URL', 'https://env.example.com/v1');
      props.settings.merged.security.auth.openaiBaseUrl =
        'https://stored.example.com/v1';
      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      expect(mockedUseTextBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          initialText: 'https://stored.example.com/v1',
        }),
      );
      unmount();
    });

    it('stores the base URL and finalizes the OpenAI selection on submit', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      const { rerender, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(AuthType.USE_OPENAI);

      await waitFor(() => {
        expect(mockedUseKeypress.mock.calls.length).toBeGreaterThan(1);
      });
      mockBuffer.text = 'https://custom.example.com/v1';
      mockBuffer.viewportVisualLines = ['https://custom.example.com/v1'];
      rerender(<AuthDialog {...props} />);
      const textInputHandler = mockedUseKeypress.mock.calls.at(-1)![0];
      act(() => {
        textInputHandler({
          name: 'enter',
          shift: false,
          alt: false,
          ctrl: false,
          cmd: false,
          sequence: '\r',
        });
      });

      expect(props.settings.setValue).toHaveBeenCalledWith(
        expect.any(String),
        'security.auth.openaiBaseUrl',
        'https://custom.example.com/v1',
      );
      expect(props.settings.setValue).toHaveBeenCalledWith(
        expect.any(String),
        'security.auth.selectedType',
        AuthType.USE_OPENAI,
      );
      expect(props.setAuthState).toHaveBeenCalledWith(
        AuthState.Unauthenticated,
      );
      unmount();
    });

    it('clears the stored base URL when the input is submitted empty', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      const { rerender, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(AuthType.USE_OPENAI);

      await waitFor(() => {
        expect(mockedUseKeypress.mock.calls.length).toBeGreaterThan(1);
      });
      mockBuffer.text = '';
      mockBuffer.viewportVisualLines = [''];
      rerender(<AuthDialog {...props} />);
      const textInputHandler = mockedUseKeypress.mock.calls.at(-1)![0];
      act(() => {
        textInputHandler({
          name: 'enter',
          shift: false,
          alt: false,
          ctrl: false,
          cmd: false,
          sequence: '\r',
        });
      });

      expect(props.settings.setValue).toHaveBeenCalledWith(
        expect.any(String),
        'security.auth.openaiBaseUrl',
        undefined,
      );
      expect(props.setAuthState).toHaveBeenCalledWith(
        AuthState.Unauthenticated,
      );
      unmount();
    });

    it('rejects an invalid base URL', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      const { rerender, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(AuthType.USE_OPENAI);

      await waitFor(() => {
        expect(mockedUseKeypress.mock.calls.length).toBeGreaterThan(1);
      });
      mockBuffer.text = 'not-a-url';
      mockBuffer.viewportVisualLines = ['not-a-url'];
      rerender(<AuthDialog {...props} />);
      const textInputHandler = mockedUseKeypress.mock.calls.at(-1)![0];
      act(() => {
        textInputHandler({
          name: 'enter',
          shift: false,
          alt: false,
          ctrl: false,
          cmd: false,
          sequence: '\r',
        });
      });

      expect(props.onAuthError).toHaveBeenCalledWith(
        'Invalid base URL: "not-a-url".',
      );
      expect(props.settings.setValue).not.toHaveBeenCalled();
      expect(props.setAuthState).not.toHaveBeenCalled();
      unmount();
    });

    it('returns to the auth method list on escape', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      const { lastFrame, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(AuthType.USE_OPENAI);

      await waitFor(() => {
        expect(lastFrame()).toContain('Enter OpenAI-compatible Base URL');
      });
      const textInputHandler = mockedUseKeypress.mock.calls.at(-1)![0];
      act(() => {
        textInputHandler({
          name: 'escape',
          shift: false,
          alt: false,
          ctrl: false,
          cmd: false,
          sequence: '\u001b',
        });
      });

      await waitFor(() => {
        expect(lastFrame()).toContain('Get started');
      });
      expect(props.settings.setValue).not.toHaveBeenCalled();
      unmount();
    });
  });

  it('displays authError when provided', async () => {
    props.authError = 'Something went wrong';
    const { lastFrame, unmount } = await renderWithProviders(
      <AuthDialog {...props} />,
    );
    expect(lastFrame()).toContain('Something went wrong');
    unmount();
  });

  describe('useKeypress', () => {
    it.each([
      {
        desc: 'does nothing on escape if authError is present',
        setup: () => {
          props.authError = 'Some error';
        },
        expectations: (p: typeof props) => {
          expect(p.onAuthError).not.toHaveBeenCalled();
          expect(p.setAuthState).not.toHaveBeenCalled();
        },
      },
      {
        desc: 'calls onAuthError on escape if no auth method is set',
        setup: () => {
          props.settings.merged.security.auth.selectedType = undefined;
        },
        expectations: (p: typeof props) => {
          expect(p.onAuthError).toHaveBeenCalledWith(
            'You must select an auth method to proceed. Press Ctrl+C twice to exit.',
          );
        },
      },
      {
        desc: 'calls setAuthState(Unauthenticated) on escape if auth method is set',
        setup: () => {
          props.settings.merged.security.auth.selectedType =
            AuthType.USE_GEMINI;
        },
        expectations: (p: typeof props) => {
          expect(p.setAuthState).toHaveBeenCalledWith(
            AuthState.Unauthenticated,
          );
          expect(p.settings.setValue).not.toHaveBeenCalled();
        },
      },
    ])('$desc', async ({ setup, expectations }) => {
      setup();
      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      const keypressHandler = mockedUseKeypress.mock.calls[0][0];
      keypressHandler({ name: 'escape' });
      expectations(props);
      unmount();
    });
  });

  describe('Snapshots', () => {
    it('renders correctly with default props', async () => {
      const { lastFrame, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      expect(lastFrame()).toMatchSnapshot();
      unmount();
    });

    it('renders correctly with auth error', async () => {
      props.authError = 'Something went wrong';
      const { lastFrame, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      expect(lastFrame()).toMatchSnapshot();
      unmount();
    });

    it('renders correctly with enforced auth type', async () => {
      props.settings.merged.security.auth.enforcedType = AuthType.USE_GEMINI;
      const { lastFrame, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      expect(lastFrame()).toMatchSnapshot();
      unmount();
    });

    it('renders the base URL input when OpenAI is selected', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      const { lastFrame, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(AuthType.USE_OPENAI);
      await waitFor(() => {
        expect(lastFrame()).toContain('Enter OpenAI-compatible Base URL');
      });
      expect(lastFrame()).toMatchSnapshot();
      unmount();
    });
  });
});
