/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { render } from '../../test-utils/render.js';
import type { Config } from 'sparkle-cli-core';
import { usePrivacySettings } from './usePrivacySettings.js';

describe('usePrivacySettings', () => {
  const mockConfig = {} as unknown as Config;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderPrivacySettingsHook = async () => {
    let hookResult: ReturnType<typeof usePrivacySettings>;
    function TestComponent() {
      hookResult = usePrivacySettings(mockConfig);
      return null;
    }
    await render(<TestComponent />);
    return {
      result: {
        get current() {
          return hookResult;
        },
      },
    };
  };

  it('should start not loading without errors', async () => {
    const { result } = await act(async () => renderPrivacySettingsHook());

    expect(result.current.privacyState.isLoading).toBe(false);
    expect(result.current.privacyState.error).toBeUndefined();
  });

  it('should keep state after updateDataCollectionOptIn', async () => {
    const { result } = await act(async () => renderPrivacySettingsHook());

    await act(async () => {
      await result.current.updateDataCollectionOptIn(true);
    });

    expect(result.current.privacyState.isLoading).toBe(false);
    expect(result.current.privacyState.dataCollectionOptIn).toBeUndefined();
  });
});
