/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyModelSelection } from './policyHelpers.js';
import type { Config } from '../config/config.js';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  SPARKLE_MODEL_ALIAS_AUTO,
} from '../config/models.js';
import { ModelAvailabilityService } from './modelAvailabilityService.js';
import { ModelConfigService } from '../services/modelConfigService.js';
import { DEFAULT_MODEL_CONFIGS } from '../config/defaultModelConfigs.js';

describe('Fallback Integration', () => {
  let config: Config;
  let availabilityService: ModelAvailabilityService;
  let modelConfigService: ModelConfigService;

  beforeEach(() => {
    // Mocking Config because it has many dependencies
    config = {
      getModel: () => SPARKLE_MODEL_ALIAS_AUTO,
      getActiveModel: () => SPARKLE_MODEL_ALIAS_AUTO,
      setActiveModel: vi.fn(),
      getModelAvailabilityService: () => availabilityService,
      modelConfigService: undefined as unknown as ModelConfigService,
    } as unknown as Config;

    availabilityService = new ModelAvailabilityService();
    modelConfigService = new ModelConfigService(DEFAULT_MODEL_CONFIGS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (config as any).modelConfigService = modelConfigService;
  });

  it('should select fallback model when primary model is terminal and config is in AUTO mode', () => {
    // 1. Simulate "Pro" failing with a terminal quota error
    // The policy chain for DEFAULT_GEMINI_MODEL_AUTO is [DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_FLASH_MODEL]
    availabilityService.markTerminal(DEFAULT_GEMINI_MODEL, 'quota');

    // 2. Request "Pro" explicitly (as Agent would)
    const requestedModel = DEFAULT_GEMINI_MODEL;

    // 3. Apply model selection
    const result = applyModelSelection(config, {
      model: requestedModel,
      isChatModel: true,
    });

    // 4. Expect fallback to Flash
    expect(result.model).toBe(DEFAULT_GEMINI_FLASH_MODEL);

    // 5. Expect active model to be updated
    expect(config.setActiveModel).toHaveBeenCalledWith(
      DEFAULT_GEMINI_FLASH_MODEL,
    );
  });

  it('should fallback even when config is NOT in AUTO mode (all Gemini models get the Gemini 3 chain)', () => {
    // 1. Config is explicitly set to Pro, not Auto
    vi.spyOn(config, 'getModel').mockReturnValue(DEFAULT_GEMINI_MODEL);

    // 2. Simulate "Pro" failing
    availabilityService.markTerminal(DEFAULT_GEMINI_MODEL, 'quota');

    // 3. Request "Pro"
    const requestedModel = DEFAULT_GEMINI_MODEL;

    // 4. Apply model selection
    const result = applyModelSelection(config, { model: requestedModel });

    // 5. Expect fallback to Flash (single-model chain only applies to custom models)
    expect(result.model).toBe(DEFAULT_GEMINI_FLASH_MODEL);
  });

  it('should NOT fallback for a custom model', () => {
    // 1. Config is explicitly set to a custom model
    vi.spyOn(config, 'getModel').mockReturnValue('my-custom-model');

    // 2. Simulate the custom model failing
    availabilityService.markTerminal('my-custom-model', 'quota');

    // 3. Request the custom model
    const result = applyModelSelection(config, { model: 'my-custom-model' });

    // 4. Expect no fallback (single-model chain)
    expect(result.model).toBe('my-custom-model');
  });

  it('should fallback to Flash after failures and restore Pro on next turn', () => {
    const requestedModel = DEFAULT_GEMINI_MODEL;

    // 1. Initial call should return Pro with 3 attempts
    const result1 = applyModelSelection(config, {
      model: requestedModel,
      isChatModel: true,
    });
    expect(result1.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(result1.maxAttempts).toBe(3);

    // 2. Simulate failure and transition to sticky_retry with consumed=true
    availabilityService.markRetryOncePerTurn(DEFAULT_GEMINI_MODEL, 3);
    availabilityService.consumeStickyAttempt(DEFAULT_GEMINI_MODEL);

    // 3. Next call in same turn should fallback to Flash
    const result2 = applyModelSelection(config, {
      model: requestedModel,
      isChatModel: true,
    });
    expect(result2.model).toBe(DEFAULT_GEMINI_FLASH_MODEL);

    // 4. Reset turn (start of new interaction)
    availabilityService.resetTurn();

    // 5. Next call should restore Pro with 3 attempts
    const result3 = applyModelSelection(config, {
      model: requestedModel,
      isChatModel: true,
    });
    expect(result3.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(result3.maxAttempts).toBe(3);
  });
});
