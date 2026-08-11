/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { ModelDialog } from './ModelDialog.js';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { createMockSettings } from '../../test-utils/settings.js';
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_ALIAS_AUTO,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
} from 'sparkle-cli-core';
import type { Config, ModelSlashCommandEvent } from 'sparkle-cli-core';

// Mock dependencies
const mockGetDisplayString = vi.fn();
const mockLogModelSlashCommand = vi.fn();
const mockModelSlashCommandEvent = vi.fn();

vi.mock('sparkle-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sparkle-cli-core')>();
  return {
    ...actual,
    getDisplayString: (val: string) => mockGetDisplayString(val),
    logModelSlashCommand: (config: Config, event: ModelSlashCommandEvent) =>
      mockLogModelSlashCommand(config, event),
    ModelSlashCommandEvent: class {
      constructor(model: string) {
        mockModelSlashCommandEvent(model);
      }
    },
  };
});

describe('<ModelDialog />', () => {
  const mockSetModel = vi.fn();
  const mockGetModel = vi.fn();
  const mockOnClose = vi.fn();
  const mockGetProModelNoAccess = vi.fn();
  const mockGetProModelNoAccessSync = vi.fn();

  interface MockConfig extends Partial<Config> {
    setModel: (model: string, isTemporary?: boolean) => void;
    getModel: () => string;
    getIdeMode: () => boolean;
    getProModelNoAccess: () => Promise<boolean>;
    getProModelNoAccessSync: () => boolean;
    getLastRetrievedQuota: () =>
      | {
          buckets: Array<{
            modelId?: string;
            remainingFraction?: number;
            resetTime?: string;
          }>;
        }
      | undefined;
    getModelConfigService: () => ReturnType<Config['getModelConfigService']>;
  }

  const mockModelConfigService = {
    getAvailableModelOptions: vi.fn(
      (context: { hasAccessToProModel?: boolean }) => {
        const options = [
          {
            modelId: GEMINI_MODEL_ALIAS_AUTO,
            tier: 'auto',
            name: mockGetDisplayString(GEMINI_MODEL_ALIAS_AUTO),
            description: 'Auto description',
          },
          {
            modelId: DEFAULT_GEMINI_FLASH_LITE_MODEL,
            tier: 'flash-lite',
            name: mockGetDisplayString(DEFAULT_GEMINI_FLASH_LITE_MODEL),
            description: 'Flash Lite description',
          },
          {
            modelId: DEFAULT_GEMINI_FLASH_MODEL,
            tier: 'flash',
            name: mockGetDisplayString(DEFAULT_GEMINI_FLASH_MODEL),
            description: 'Flash description',
          },
          {
            modelId: DEFAULT_GEMINI_MODEL,
            tier: 'pro',
            name: mockGetDisplayString(DEFAULT_GEMINI_MODEL),
            description: 'Pro description',
          },
        ];
        return context?.hasAccessToProModel === false
          ? options.filter((o) => o.tier !== 'pro')
          : options;
      },
    ),
    getModelDefinition: vi.fn((modelId: string) =>
      modelId === GEMINI_MODEL_ALIAS_AUTO
        ? { tier: 'auto', isVisible: true }
        : modelId === DEFAULT_GEMINI_MODEL
          ? { tier: 'pro', isVisible: true }
          : modelId === DEFAULT_GEMINI_FLASH_MODEL
            ? { tier: 'flash', isVisible: true }
            : modelId === DEFAULT_GEMINI_FLASH_LITE_MODEL
              ? { tier: 'flash-lite', isVisible: true }
              : undefined,
    ),
  };

  const mockConfig: MockConfig = {
    setModel: mockSetModel,
    getModel: mockGetModel,
    getIdeMode: () => false,
    getProModelNoAccess: mockGetProModelNoAccess,
    getProModelNoAccessSync: mockGetProModelNoAccessSync,
    getLastRetrievedQuota: () => ({ buckets: [] }),
    getSessionId: () => 'test-session-id',
    getModelConfigService: () =>
      mockModelConfigService as unknown as ReturnType<
        Config['getModelConfigService']
      >,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockGetModel.mockReturnValue(GEMINI_MODEL_ALIAS_AUTO);
    mockGetProModelNoAccess.mockResolvedValue(false);
    mockGetProModelNoAccessSync.mockReturnValue(false);

    // Default implementation for getDisplayString
    mockGetDisplayString.mockImplementation((val: string) => {
      if (val === 'auto') return 'Auto';
      return val;
    });
  });

  const renderComponent = async (
    configValue = mockConfig as unknown as Config,
  ) => {
    const settings = createMockSettings({});

    const result = await renderWithProviders(
      <ModelDialog onClose={mockOnClose} />,
      {
        config: configValue,
        settings,
      },
    );
    return result;
  };

  it('renders the initial "main" view correctly', async () => {
    const { lastFrame, unmount } = await renderComponent();
    expect(lastFrame()).toContain('Select Model');
    expect(lastFrame()).toContain('Remember model for future sessions: false');
    expect(lastFrame()).toContain('Auto');
    expect(lastFrame()).toContain('Manual');
    unmount();
  });

  it('renders the "manual" view initially for users with no pro access and filters Pro models with correct order', async () => {
    mockGetProModelNoAccessSync.mockReturnValue(true);
    mockGetProModelNoAccess.mockResolvedValue(true);
    mockGetDisplayString.mockImplementation((val: string) => val);

    const { lastFrame, unmount } = await renderComponent();

    const output = lastFrame();
    expect(output).toContain('Select Model');
    expect(output).not.toContain(DEFAULT_GEMINI_MODEL);

    // Verify order: Flash Lite -> Flash
    const flashLiteIdx = output.indexOf(DEFAULT_GEMINI_FLASH_LITE_MODEL);
    const flashIdx = output.indexOf(DEFAULT_GEMINI_FLASH_MODEL);

    expect(flashLiteIdx).toBeLessThan(flashIdx);

    expect(output).not.toContain('Auto');
    unmount();
  });

  it('closes dialog on escape in "manual" view for users with no pro access', async () => {
    mockGetProModelNoAccessSync.mockReturnValue(true);
    mockGetProModelNoAccess.mockResolvedValue(true);
    const { stdin, waitUntilReady, unmount } = await renderComponent();

    // Already in manual view
    await act(async () => {
      stdin.write('\u001B'); // Escape
    });
    await act(async () => {
      await waitUntilReady();
    });

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
    unmount();
  });

  it('switches to "manual" view when "Manual" is selected and uses getDisplayString for models', async () => {
    mockGetDisplayString.mockImplementation((val: string) => {
      if (val === DEFAULT_GEMINI_MODEL) return 'Formatted Pro Model';
      if (val === DEFAULT_GEMINI_FLASH_MODEL) return 'Formatted Flash Model';
      if (val === DEFAULT_GEMINI_FLASH_LITE_MODEL)
        return 'Formatted Lite Model';
      return val;
    });

    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderComponent();

    // Select "Manual" (index 1)
    // Press down arrow to move to "Manual"
    await act(async () => {
      stdin.write('\u001B[B'); // Arrow Down
    });
    await waitUntilReady();

    // Press enter to select
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    // Should now show manual options
    await waitFor(() => {
      const output = lastFrame();
      expect(output).toContain('Formatted Pro Model');
      expect(output).toContain('Formatted Flash Model');
      expect(output).toContain('Formatted Lite Model');
    });
    unmount();
  });

  it('sets model and closes when a model is selected in "main" view', async () => {
    const { stdin, waitUntilReady, unmount } = await renderComponent();

    // Select "Auto" (index 0)
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenCalledWith(
        GEMINI_MODEL_ALIAS_AUTO,
        true, // Session only by default
      );
      expect(mockOnClose).toHaveBeenCalled();
    });
    unmount();
  });

  it('sets model and closes when a model is selected in "manual" view', async () => {
    const { stdin, waitUntilReady, unmount } = await renderComponent();

    // Navigate to Manual (index 1) and select
    await act(async () => {
      stdin.write('\u001B[B');
    });
    await waitUntilReady();
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    // Now in manual view. Default selection is the first item (flash-lite)
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenCalledWith(
        DEFAULT_GEMINI_FLASH_LITE_MODEL,
        true,
      );
      expect(mockOnClose).toHaveBeenCalled();
    });
    unmount();
  });

  it('toggles persist mode with Tab key', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderComponent();

    expect(lastFrame()).toContain('Remember model for future sessions: false');

    // Press Tab to toggle persist mode
    await act(async () => {
      stdin.write('\t');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(lastFrame()).toContain('Remember model for future sessions: true');
    });

    // Select "Auto" (index 0)
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenCalledWith(
        GEMINI_MODEL_ALIAS_AUTO,
        false, // Persist enabled
      );
      expect(mockOnClose).toHaveBeenCalled();
    });
    unmount();
  });

  it('closes dialog on escape in "main" view', async () => {
    const { stdin, waitUntilReady, unmount } = await renderComponent();

    await act(async () => {
      stdin.write('\u001B'); // Escape
    });
    // Escape key has a 50ms timeout in KeypressContext, so we need to wrap waitUntilReady in act
    await act(async () => {
      await waitUntilReady();
    });

    await waitFor(() => {
      expect(mockOnClose).toHaveBeenCalled();
    });
    unmount();
  });

  it('goes back to "main" view on escape in "manual" view', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderComponent();

    // Go to manual view
    await act(async () => {
      stdin.write('\u001B[B');
    });
    await waitUntilReady();
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(lastFrame()).toContain(DEFAULT_GEMINI_MODEL);
    });

    // Press Escape
    await act(async () => {
      stdin.write('\u001B');
    });
    await act(async () => {
      await waitUntilReady();
    });

    await waitFor(() => {
      expect(mockOnClose).not.toHaveBeenCalled();
      // Should be back to main view (Manual option visible)
      expect(lastFrame()).toContain('Manual');
    });
    unmount();
  });

  it('shows the preferred manual model in the main view option using getDisplayString', async () => {
    mockGetModel.mockReturnValue(DEFAULT_GEMINI_MODEL);
    mockGetDisplayString.mockImplementation((val: string) => {
      if (val === DEFAULT_GEMINI_MODEL) return 'My Custom Model Display';
      if (val === 'auto') return 'Auto';
      return val;
    });
    const { lastFrame, unmount } = await renderComponent();

    expect(lastFrame()).toContain('Manual (My Custom Model Display)');
    unmount();
  });

  it('shows the default models in the manual view', async () => {
    const { lastFrame, stdin, waitUntilReady, unmount } =
      await renderComponent();

    // Go to manual view
    await act(async () => {
      stdin.write('\u001B[B'); // Manual
    });
    await waitUntilReady();
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    const output = lastFrame();
    expect(output).toContain(DEFAULT_GEMINI_MODEL);
    expect(output).toContain(DEFAULT_GEMINI_FLASH_MODEL);
    expect(output).toContain(DEFAULT_GEMINI_FLASH_LITE_MODEL);
    unmount();
  });

  it('sets the default model when selected in the manual view', async () => {
    const { stdin, waitUntilReady, unmount } = await renderComponent();

    // Go to manual view
    await act(async () => {
      stdin.write('\u001B[B'); // Manual
    });
    await waitUntilReady();
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    // Select the first model (DEFAULT_GEMINI_FLASH_LITE_MODEL)
    await act(async () => {
      stdin.write('\r');
    });
    await waitUntilReady();

    await waitFor(() => {
      expect(mockSetModel).toHaveBeenCalledWith(
        DEFAULT_GEMINI_FLASH_LITE_MODEL,
        true,
      );
    });
    unmount();
  });
});
