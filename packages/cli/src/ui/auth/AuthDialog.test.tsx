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
import {
  ProviderType,
  DEFAULT_OPENAI_BASE_URL,
  loadApiKey,
  saveApiKey,
} from 'sparkle-cli-core';
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

vi.mock('sparkle-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sparkle-cli-core')>();
  return {
    ...actual,
    loadApiKey: vi.fn(),
    saveApiKey: vi.fn(),
  };
});

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
const mockedLoadApiKey = loadApiKey as Mock;
const mockedSaveApiKey = saveApiKey as Mock;

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
    mockedLoadApiKey.mockResolvedValue(null);
    mockedSaveApiKey.mockResolvedValue(undefined);

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
    expect(items[0].value).toBe(ProviderType.USE_GEMINI);
    expect(items[0].label).toBe('Use Gemini API');
    expect(items[1].value).toBe(ProviderType.USE_OPENAI);
    expect(items[1].label).toBe('Use OpenAI-compatible API');
    unmount();
  });

  it('filters auth types when enforcedType is set', async () => {
    props.settings.merged.security.auth.enforcedType = ProviderType.USE_GEMINI;
    const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
    const items = mockedRadioButtonSelect.mock.calls[0][0].items;
    expect(items).toHaveLength(1);
    expect(items[0].value).toBe(ProviderType.USE_GEMINI);
    unmount();
  });

  it('shows all auth types when enforcedType is not a valid option', async () => {
    props.settings.merged.security.auth.enforcedType =
      'gateway' as ProviderType;
    const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
    const items = mockedRadioButtonSelect.mock.calls[0][0].items;
    expect(items).toHaveLength(2);
    unmount();
  });

  it('sets initial index to 0 when enforcedType is set', async () => {
    props.settings.merged.security.auth.enforcedType = ProviderType.USE_GEMINI;
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
            ProviderType.USE_GEMINI;
        },
        expected: ProviderType.USE_GEMINI,
        desc: 'from settings',
      },
      {
        setup: () => {
          vi.stubEnv('GEMINI_DEFAULT_AUTH_TYPE', ProviderType.USE_GEMINI);
        },
        expected: ProviderType.USE_GEMINI,
        desc: 'from GEMINI_DEFAULT_AUTH_TYPE env var',
      },
      {
        setup: () => {
          vi.stubEnv('GEMINI_API_KEY', 'test-key');
        },
        expected: ProviderType.USE_GEMINI,
        desc: 'from GEMINI_API_KEY env var',
      },
      {
        setup: () => {},
        expected: ProviderType.USE_GEMINI,
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
      await handleAuthSelect(ProviderType.USE_GEMINI);

      expect(mockedValidateAuthMethod).toHaveBeenCalledWith(
        ProviderType.USE_GEMINI,
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
      await handleAuthSelect(ProviderType.USE_GEMINI);

      expect(props.settings.setValue).toHaveBeenCalledWith(
        expect.any(String),
        'security.auth.selectedType',
        ProviderType.USE_GEMINI,
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
      await handleAuthSelect(ProviderType.USE_GEMINI);

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
      await handleAuthSelect(ProviderType.USE_GEMINI);

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
      await handleAuthSelect(ProviderType.USE_GEMINI);

      expect(props.setAuthState).toHaveBeenCalledWith(
        AuthState.AwaitingApiKeyInput,
      );
      unmount();
    });

    it('always shows API key dialog on re-auth even if env var is present', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      vi.stubEnv('GEMINI_API_KEY', 'test-key-from-env');
      // Simulate switching from a different auth method (e.g., OpenAI → API key)
      props.settings.merged.security.auth.selectedType =
        ProviderType.USE_OPENAI;

      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(ProviderType.USE_GEMINI);

      expect(props.setAuthState).toHaveBeenCalledWith(
        AuthState.AwaitingApiKeyInput,
      );
      unmount();
    });
  });

  describe('OpenAI config flow', () => {
    it('shows the combined base URL and API key form when OpenAI is selected', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      const { lastFrame, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(ProviderType.USE_OPENAI);

      await waitFor(() => {
        expect(lastFrame()).toContain('Configure OpenAI-compatible API');
      });
      expect(lastFrame()).toContain('Base URL');
      expect(lastFrame()).toContain('API Key');
      // Selection is not finalized until the config is submitted.
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

    it('pre-fills the API key input from the OPENAI_API_KEY env var', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'sk-env-key');
      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      expect(mockedUseTextBuffer).toHaveBeenCalledWith(
        expect.objectContaining({
          initialText: 'sk-env-key',
          inputFilter: expect.any(Function),
        }),
      );
      unmount();
    });

    it('pre-fills the API key input with a stored key when no env var is set', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      mockedLoadApiKey.mockResolvedValue('sk-stored-key');
      const { unmount } = await renderWithProviders(<AuthDialog {...props} />);
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(ProviderType.USE_OPENAI);

      await waitFor(() => {
        expect(mockedLoadApiKey).toHaveBeenCalledWith(ProviderType.USE_OPENAI);
      });
      expect(mockBuffer.setText).toHaveBeenCalledWith('sk-stored-key');
      unmount();
    });

    it('stores the base URL and API key and finalizes the OpenAI selection on submit', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      const baseUrlMockBuffer = {
        ...mockBuffer,
        text: DEFAULT_OPENAI_BASE_URL,
        viewportVisualLines: [DEFAULT_OPENAI_BASE_URL],
      } as unknown as TextBuffer;
      const apiKeyMockBuffer = {
        ...mockBuffer,
        text: '',
        viewportVisualLines: [''],
      } as unknown as TextBuffer;
      mockedUseTextBuffer.mockImplementation(
        (opts: { inputFilter?: unknown }) =>
          opts.inputFilter ? apiKeyMockBuffer : baseUrlMockBuffer,
      );

      const { rerender, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(ProviderType.USE_OPENAI);

      await waitFor(() => {
        expect(mockedUseKeypress.mock.calls.length).toBeGreaterThan(2);
      });

      // Step 1: submit the base URL (top input). This only moves focus to the
      // API key input below; nothing is saved yet.
      baseUrlMockBuffer.text = 'https://custom.example.com/v1';
      baseUrlMockBuffer.viewportVisualLines = ['https://custom.example.com/v1'];
      rerender(<AuthDialog {...props} />);
      const baseUrlHandler = mockedUseKeypress.mock.calls.at(-2)![0];
      act(() => {
        baseUrlHandler({
          name: 'enter',
          shift: false,
          alt: false,
          ctrl: false,
          cmd: false,
          sequence: '\r',
        });
      });
      expect(mockedSaveApiKey).not.toHaveBeenCalled();
      expect(props.settings.setValue).not.toHaveBeenCalled();
      expect(props.setAuthState).not.toHaveBeenCalled();

      // Step 2: submit the API key (bottom input). This saves the key and the
      // base URL, then finalizes the OpenAI selection.
      apiKeyMockBuffer.text = 'sk-test-key';
      apiKeyMockBuffer.viewportVisualLines = ['sk-test-key'];
      rerender(<AuthDialog {...props} />);
      const apiKeyHandler = mockedUseKeypress.mock.calls.at(-1)![0];
      await act(async () => {
        apiKeyHandler({
          name: 'enter',
          shift: false,
          alt: false,
          ctrl: false,
          cmd: false,
          sequence: '\r',
        });
      });

      expect(mockedSaveApiKey).toHaveBeenCalledWith(
        ProviderType.USE_OPENAI,
        'sk-test-key',
      );
      expect(props.settings.setValue).toHaveBeenCalledWith(
        expect.any(String),
        'security.auth.openaiBaseUrl',
        'https://custom.example.com/v1',
      );
      expect(props.settings.setValue).toHaveBeenCalledWith(
        expect.any(String),
        'security.auth.selectedType',
        ProviderType.USE_OPENAI,
      );
      expect(props.setAuthState).toHaveBeenCalledWith(
        AuthState.Unauthenticated,
      );
      unmount();
    });

    it('allows submitting with an empty API key for unauthenticated endpoints', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      const baseUrlMockBuffer = {
        ...mockBuffer,
        text: DEFAULT_OPENAI_BASE_URL,
        viewportVisualLines: [DEFAULT_OPENAI_BASE_URL],
      } as unknown as TextBuffer;
      const apiKeyMockBuffer = {
        ...mockBuffer,
        text: '',
        viewportVisualLines: [''],
      } as unknown as TextBuffer;
      mockedUseTextBuffer.mockImplementation(
        (opts: { inputFilter?: unknown }) =>
          opts.inputFilter ? apiKeyMockBuffer : baseUrlMockBuffer,
      );

      const { rerender, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(ProviderType.USE_OPENAI);

      await waitFor(() => {
        expect(mockedUseKeypress.mock.calls.length).toBeGreaterThan(2);
      });

      baseUrlMockBuffer.text = 'http://localhost:11434/v1';
      baseUrlMockBuffer.viewportVisualLines = ['http://localhost:11434/v1'];
      rerender(<AuthDialog {...props} />);
      const baseUrlHandler = mockedUseKeypress.mock.calls.at(-2)![0];
      act(() => {
        baseUrlHandler({
          name: 'enter',
          shift: false,
          alt: false,
          ctrl: false,
          cmd: false,
          sequence: '\r',
        });
      });

      rerender(<AuthDialog {...props} />);
      const apiKeyHandler = mockedUseKeypress.mock.calls.at(-1)![0];
      await act(async () => {
        apiKeyHandler({
          name: 'enter',
          shift: false,
          alt: false,
          ctrl: false,
          cmd: false,
          sequence: '\r',
        });
      });

      expect(mockedSaveApiKey).toHaveBeenCalledWith(
        ProviderType.USE_OPENAI,
        undefined,
      );
      expect(props.settings.setValue).toHaveBeenCalledWith(
        expect.any(String),
        'security.auth.openaiBaseUrl',
        'http://localhost:11434/v1',
      );
      expect(props.setAuthState).toHaveBeenCalledWith(
        AuthState.Unauthenticated,
      );
      unmount();
    });

    it('clears the stored base URL when the input is submitted empty', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      const baseUrlMockBuffer = {
        ...mockBuffer,
        text: DEFAULT_OPENAI_BASE_URL,
        viewportVisualLines: [DEFAULT_OPENAI_BASE_URL],
      } as unknown as TextBuffer;
      const apiKeyMockBuffer = {
        ...mockBuffer,
        text: '',
        viewportVisualLines: [''],
      } as unknown as TextBuffer;
      mockedUseTextBuffer.mockImplementation(
        (opts: { inputFilter?: unknown }) =>
          opts.inputFilter ? apiKeyMockBuffer : baseUrlMockBuffer,
      );

      const { rerender, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(ProviderType.USE_OPENAI);

      await waitFor(() => {
        expect(mockedUseKeypress.mock.calls.length).toBeGreaterThan(2);
      });
      baseUrlMockBuffer.text = '';
      baseUrlMockBuffer.viewportVisualLines = [''];
      rerender(<AuthDialog {...props} />);
      const baseUrlHandler = mockedUseKeypress.mock.calls.at(-2)![0];
      act(() => {
        baseUrlHandler({
          name: 'enter',
          shift: false,
          alt: false,
          ctrl: false,
          cmd: false,
          sequence: '\r',
        });
      });

      rerender(<AuthDialog {...props} />);
      const apiKeyHandler = mockedUseKeypress.mock.calls.at(-1)![0];
      await act(async () => {
        apiKeyHandler({
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
      await handleAuthSelect(ProviderType.USE_OPENAI);

      await waitFor(() => {
        expect(mockedUseKeypress.mock.calls.length).toBeGreaterThan(2);
      });
      mockBuffer.text = 'not-a-url';
      mockBuffer.viewportVisualLines = ['not-a-url'];
      rerender(<AuthDialog {...props} />);
      const baseUrlHandler = mockedUseKeypress.mock.calls.at(-2)![0];
      act(() => {
        baseUrlHandler({
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
      await handleAuthSelect(ProviderType.USE_OPENAI);

      await waitFor(() => {
        expect(lastFrame()).toContain('Configure OpenAI-compatible API');
      });
      const baseUrlHandler = mockedUseKeypress.mock.calls.at(-2)![0];
      act(() => {
        baseUrlHandler({
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
            ProviderType.USE_GEMINI;
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
      props.settings.merged.security.auth.enforcedType =
        ProviderType.USE_GEMINI;
      const { lastFrame, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      expect(lastFrame()).toMatchSnapshot();
      unmount();
    });

    it('renders the OpenAI config form when OpenAI is selected', async () => {
      mockedValidateAuthMethod.mockResolvedValue(null);
      const { lastFrame, unmount } = await renderWithProviders(
        <AuthDialog {...props} />,
      );
      const { onSelect: handleAuthSelect } =
        mockedRadioButtonSelect.mock.calls[0][0];
      await handleAuthSelect(ProviderType.USE_OPENAI);
      await waitFor(() => {
        expect(lastFrame()).toContain('Configure OpenAI-compatible API');
      });
      expect(lastFrame()).toMatchSnapshot();
      unmount();
    });
  });
});
