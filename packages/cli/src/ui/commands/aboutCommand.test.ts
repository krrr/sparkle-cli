/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { aboutCommand } from './aboutCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';
import { IdeClient, getVersion } from 'sparkle-cli-core';

vi.mock('sparkle-cli-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sparkle-cli-core')>();
  return {
    ...actual,
    IdeClient: {
      getInstance: vi.fn().mockResolvedValue({
        getDetectedIdeDisplayName: vi.fn().mockReturnValue('test-ide'),
      }),
    },
    getVersion: vi.fn(),
  };
});

describe('aboutCommand', () => {
  let mockContext: CommandContext;
  const originalPlatform = process.platform;
  const originalVersion = process.version;
  const memoryUsageSpy = vi.spyOn(process, 'memoryUsage');
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockContext = createMockCommandContext({
      services: {
        agentContext: {
          config: {
            getModel: vi.fn(),
            getIdeMode: vi.fn().mockReturnValue(true),
            getProviderProfileService: vi.fn().mockReturnValue({
              getActiveProfile: vi.fn().mockReturnValue({
                id: 'test-auth',
                providerType: 'gemini-api-key',
              }),
            }),
          },
        },
        settings: {
          merged: {
            security: {
              auth: {},
            },
          },
        },
      },
      ui: {
        addItem: vi.fn(),
      },
    } as unknown as CommandContext);

    vi.mocked(getVersion).mockResolvedValue('test-version');
    vi.spyOn(
      mockContext.services.agentContext!.config,
      'getModel',
    ).mockReturnValue('test-model');
    Object.defineProperty(process, 'platform', {
      value: 'test-os',
    });
    Object.defineProperty(process, 'version', {
      value: 'v20.19.0',
      configurable: true,
    });
    memoryUsageSpy.mockReturnValue({
      rss: 100 * 1024 * 1024,
    } as NodeJS.MemoryUsage);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
    Object.defineProperty(process, 'version', {
      value: originalVersion,
      configurable: true,
    });
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('should have the correct name and description', () => {
    expect(aboutCommand.name).toBe('about');
    expect(aboutCommand.description).toBe('Show version info');
  });

  it('should call addItem with all version info', async () => {
    process.env['SANDBOX'] = '';
    if (!aboutCommand.action) {
      throw new Error('The about command must have an action.');
    }

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith({
      type: MessageType.ABOUT,
      about: {
        cliVersion: 'test-version',
        osVersion: 'test-os',
        sandboxEnv: 'no sandbox',
        nodeVersion: 'v20.19.0',
        memoryUsage: '100.0 MB',
        modelVersion: 'test-model',
        selectedAuthType: 'test-auth (gemini-api-key)',
        ideClient: 'test-ide',
      },
    });
  });

  it('should show the correct sandbox environment variable', async () => {
    process.env['SANDBOX'] = 'sparkle-sandbox';
    if (!aboutCommand.action) {
      throw new Error('The about command must have an action.');
    }

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        about: expect.objectContaining({
          sandboxEnv: 'sparkle-sandbox',
        }),
      }),
    );
  });

  it('should not show ide client when it is not detected', async () => {
    vi.mocked(IdeClient.getInstance).mockResolvedValue({
      getDetectedIdeDisplayName: vi.fn().mockReturnValue(undefined),
    } as unknown as IdeClient);

    process.env['SANDBOX'] = '';
    if (!aboutCommand.action) {
      throw new Error('The about command must have an action.');
    }

    await aboutCommand.action(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: MessageType.ABOUT,
        about: expect.objectContaining({
          cliVersion: 'test-version',
          osVersion: 'test-os',
          sandboxEnv: 'no sandbox',
          nodeVersion: 'v20.19.0',
          memoryUsage: '100.0 MB',
          modelVersion: 'test-model',
          selectedAuthType: 'test-auth (gemini-api-key)',
          ideClient: '',
        }),
      }),
    );
  });
});
