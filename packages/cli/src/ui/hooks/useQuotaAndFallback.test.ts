/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { renderHook, mockSettings } from '../../test-utils/render.js';
import {
  type Config,
  type FallbackModelHandler,
  type GoogleApiError,
  AuthType,
  TerminalQuotaError,
  makeFakeConfig,
  RetryableQuotaError,
  ModelNotFoundError,
} from 'sparkle-cli-core';
import { useQuotaAndFallback } from './useQuotaAndFallback.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import { MessageType } from '../types.js';

// Use a type alias for SpyInstance as it's not directly exported
type SpyInstance = ReturnType<typeof vi.spyOn>;

describe('useQuotaAndFallback', () => {
  let mockConfig: Config;
  let mockHistoryManager: UseHistoryManagerReturn;
  let mockSetModelSwitchedFromQuotaError: Mock;
  let setFallbackHandlerSpy: SpyInstance;

  beforeEach(() => {
    mockConfig = makeFakeConfig();
    vi.spyOn(mockConfig, 'getContentGeneratorConfig').mockReturnValue({
      authType: AuthType.USE_GEMINI,
    });

    mockHistoryManager = {
      addItem: vi.fn(),
      history: [],
      updateItem: vi.fn(),
      clearItems: vi.fn(),
      loadHistory: vi.fn(),
    };
    mockSetModelSwitchedFromQuotaError = vi.fn();

    setFallbackHandlerSpy = vi.spyOn(mockConfig, 'setFallbackModelHandler');
    vi.spyOn(mockConfig, 'setQuotaErrorOccurred');
    vi.spyOn(mockConfig, 'setModel');
    vi.spyOn(mockConfig, 'setActiveModel');
    vi.spyOn(mockConfig, 'activateFallbackMode');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register a fallback handler on initialization', async () => {
    await renderHook(() =>
      useQuotaAndFallback({
        config: mockConfig,
        historyManager: mockHistoryManager,
        setModelSwitchedFromQuotaError: mockSetModelSwitchedFromQuotaError,
        settings: mockSettings,
      }),
    );

    expect(setFallbackHandlerSpy).toHaveBeenCalledTimes(1);
    expect(setFallbackHandlerSpy.mock.calls[0][0]).toBeInstanceOf(Function);
  });

  describe('Fallback Handler Logic', () => {
    it('should stop with an error message on TerminalQuotaError', async () => {
      const { result } = await renderHook(() =>
        useQuotaAndFallback({
          config: mockConfig,
          historyManager: mockHistoryManager,
          setModelSwitchedFromQuotaError: mockSetModelSwitchedFromQuotaError,
          settings: mockSettings,
        }),
      );

      void result;

      const handler = setFallbackHandlerSpy.mock
        .calls[0][0] as FallbackModelHandler;

      const error = new TerminalQuotaError(
        'pro quota',
        { code: 429, message: 'mock', details: [] } as GoogleApiError,
        60,
      );
      const intent = await handler('gemini-2.5-pro', 'gemini-2.5-flash', error);

      expect(intent).toBe('retry_later');
      expect(mockHistoryManager.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: expect.stringContaining('Usage limit reached'),
        }),
        expect.any(Number),
      );
      expect(mockSetModelSwitchedFromQuotaError).not.toHaveBeenCalled();
    });

    it('should stop with an error message on ModelNotFoundError', async () => {
      await renderHook(() =>
        useQuotaAndFallback({
          config: mockConfig,
          historyManager: mockHistoryManager,
          setModelSwitchedFromQuotaError: mockSetModelSwitchedFromQuotaError,
          settings: mockSettings,
        }),
      );

      const handler = setFallbackHandlerSpy.mock
        .calls[0][0] as FallbackModelHandler;

      const error = new ModelNotFoundError('No model found');
      const intent = await handler(
        'some-unknown-model',
        'gemini-2.5-flash',
        error,
      );

      expect(intent).toBe('retry_later');
      expect(mockHistoryManager.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: expect.stringContaining('was not found or is invalid'),
        }),
        expect.any(Number),
      );
    });

    it('should auto-retry once in low verbosity mode on capacity errors', async () => {
      await renderHook(() =>
        useQuotaAndFallback({
          config: mockConfig,
          historyManager: mockHistoryManager,
          setModelSwitchedFromQuotaError: mockSetModelSwitchedFromQuotaError,
          settings: mockSettings,
          errorVerbosity: 'low',
        }),
      );

      const handler = setFallbackHandlerSpy.mock
        .calls[0][0] as FallbackModelHandler;

      const error = new RetryableQuotaError('rate limited', {
        code: 429,
        message: 'mock',
        details: [],
      } as GoogleApiError);
      const intent = await handler('gemini-2.5-pro', 'gemini-2.5-flash', error);

      expect(intent).toBe('retry_once');
    });

    it('should auto-switch to the fallback model on capacity errors in full verbosity', async () => {
      await renderHook(() =>
        useQuotaAndFallback({
          config: mockConfig,
          historyManager: mockHistoryManager,
          setModelSwitchedFromQuotaError: mockSetModelSwitchedFromQuotaError,
          settings: mockSettings,
        }),
      );

      const handler = setFallbackHandlerSpy.mock
        .calls[0][0] as FallbackModelHandler;

      const error = new RetryableQuotaError('rate limited', {
        code: 429,
        message: 'mock',
        details: [],
      } as GoogleApiError);
      const intent = await handler('gemini-2.5-pro', 'gemini-2.5-flash', error);

      expect(intent).toBe('retry_always');
      expect(mockSetModelSwitchedFromQuotaError).toHaveBeenCalledWith(true);
      expect(mockConfig.setQuotaErrorOccurred).toHaveBeenCalledWith(true);
      expect(mockHistoryManager.addItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: expect.stringContaining('Switching to fallback model'),
        }),
        expect.any(Number),
      );
    });
  });
});
