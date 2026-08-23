/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  resolveModel,
  resolveClassifierModel,
  isCustomModel,
  isAutoModel,
  getDisplayString,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  supportsMultimodalFunctionResponse,
  SPARKLE_MODEL_ALIAS_PRO,
  SPARKLE_MODEL_ALIAS_FLASH,
  SPARKLE_MODEL_ALIAS_FLASH_LITE,
  SPARKLE_MODEL_ALIAS_AUTO,
  isProModel,
  getAutoModelDescription,
} from './models.js';
import type { Config } from './config.js';
import { ModelConfigService } from '../services/modelConfigService.js';
import { DEFAULT_MODEL_CONFIGS } from './defaultModelConfigs.js';

const modelConfigService = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

const config = {
  modelConfigService,
} as unknown as Config;

describe('config-driven model resolution', () => {
  it('resolveModel resolves aliases via the model config service', () => {
    expect(resolveModel(SPARKLE_MODEL_ALIAS_AUTO, config)).toBe(
      DEFAULT_GEMINI_MODEL,
    );
    expect(resolveModel(SPARKLE_MODEL_ALIAS_PRO, config)).toBe(
      DEFAULT_GEMINI_MODEL,
    );
    expect(resolveModel(SPARKLE_MODEL_ALIAS_FLASH, config)).toBe(
      DEFAULT_GEMINI_FLASH_MODEL,
    );
    expect(resolveModel(SPARKLE_MODEL_ALIAS_FLASH_LITE, config)).toBe(
      DEFAULT_GEMINI_FLASH_LITE_MODEL,
    );
  });

  it('resolveModel passes unknown models through without flash-suffix coercion', () => {
    // Accepted behavior change: no implicit remapping of names ending in 'flash'.
    expect(resolveModel('gemini-2.0-flash', config)).toBe('gemini-2.0-flash');
    expect(resolveModel('custom-flash', config)).toBe('custom-flash');
  });

  it('resolveModel passes "none" through unchanged', () => {
    // Accepted behavior change: no special-casing of the 'none' model.
    expect(resolveModel('none', config)).toBe('none');
  });

  it('resolveClassifierModel resolves via the classifier id resolutions', () => {
    expect(
      resolveClassifierModel(
        SPARKLE_MODEL_ALIAS_AUTO,
        SPARKLE_MODEL_ALIAS_FLASH,
        config,
      ),
    ).toBe(DEFAULT_GEMINI_FLASH_MODEL);
    expect(
      resolveClassifierModel(
        SPARKLE_MODEL_ALIAS_AUTO,
        SPARKLE_MODEL_ALIAS_PRO,
        config,
      ),
    ).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('isProModel is tier-based when a config is provided', () => {
    expect(isProModel(DEFAULT_GEMINI_MODEL, config)).toBe(true);
    // Custom models with 'pro' in the name are no longer treated as Pro.
    expect(isProModel('custom-pro-model', config)).toBe(false);
  });

  it('isCustomModel and isAutoModel honor definition tiers', () => {
    expect(isCustomModel('custom-model', config)).toBe(true);
    expect(isCustomModel(DEFAULT_GEMINI_MODEL, config)).toBe(false);
    expect(isAutoModel(SPARKLE_MODEL_ALIAS_AUTO, config)).toBe(true);
    expect(isAutoModel(DEFAULT_GEMINI_MODEL, config)).toBe(false);
  });

  it('supportsMultimodalFunctionResponse requires a definition with the feature flag', () => {
    expect(
      supportsMultimodalFunctionResponse(DEFAULT_GEMINI_MODEL, config),
    ).toBe(true);
    // Unknown gemini-* models have no definition, so the feature is not assumed.
    expect(
      supportsMultimodalFunctionResponse('gemini-unknown-model', config),
    ).toBe(false);
  });
});

describe('isProModel', () => {
  it('should return true for models containing "pro"', () => {
    expect(isProModel('gemini-3-pro-preview')).toBe(true);
    expect(isProModel('gemini-2.5-pro')).toBe(true);
    expect(isProModel('pro')).toBe(true);
  });

  it('should return false for models without "pro"', () => {
    expect(isProModel('gemini-3-flash-preview')).toBe(false);
    expect(isProModel('gemini-2.5-flash')).toBe(false);
    expect(isProModel('auto')).toBe(false);
  });
});

describe('isCustomModel', () => {
  it('should return true for models not starting with gemini-', () => {
    expect(isCustomModel('testing')).toBe(true);
    expect(isCustomModel('gpt-4')).toBe(true);
    expect(isCustomModel('claude-3')).toBe(true);
  });

  it('should return false for Gemini models', () => {
    expect(isCustomModel('gemini-1.5-pro')).toBe(false);
    expect(isCustomModel('gemini-2.0-flash')).toBe(false);
    expect(isCustomModel('gemini-3-pro-preview')).toBe(false);
  });

  it('should return false for aliases that resolve to Gemini models', () => {
    expect(isCustomModel(SPARKLE_MODEL_ALIAS_AUTO)).toBe(false);
    expect(isCustomModel(SPARKLE_MODEL_ALIAS_PRO)).toBe(false);
  });

  it('should not throw if the model is an array (e.g. from yargs)', () => {
    // @ts-expect-error - testing invalid runtime input
    expect(() => isCustomModel(['gemini-2.0-flash', 'gpt-4'])).not.toThrow();
    // @ts-expect-error - testing invalid runtime input
    expect(isCustomModel(['gemini-2.0-flash', 'gpt-4'])).toBe(true); // last one is custom
  });
});

describe('getDisplayString', () => {
  it('should return concrete model name for pro alias', () => {
    expect(getDisplayString(SPARKLE_MODEL_ALIAS_PRO)).toBe(
      DEFAULT_GEMINI_MODEL,
    );
  });

  it('should return concrete model name for flash alias', () => {
    expect(getDisplayString(SPARKLE_MODEL_ALIAS_FLASH)).toBe(
      DEFAULT_GEMINI_FLASH_MODEL,
    );
  });

  it('should return the model name as is for other models', () => {
    expect(getDisplayString('custom-model')).toBe('custom-model');
    expect(getDisplayString(DEFAULT_GEMINI_FLASH_LITE_MODEL)).toBe(
      DEFAULT_GEMINI_FLASH_LITE_MODEL,
    );
  });
});

describe('supportsMultimodalFunctionResponse', () => {
  it('should return true for gemini-3 model', () => {
    expect(supportsMultimodalFunctionResponse('gemini-3-pro')).toBe(true);
    expect(supportsMultimodalFunctionResponse('gemini-pro-latest')).toBe(true);
  });

  it('should return false for other models', () => {
    expect(supportsMultimodalFunctionResponse('some-other-model')).toBe(false);
    expect(supportsMultimodalFunctionResponse('')).toBe(false);
  });
});

describe('resolveModel', () => {
  it('should return the Default Pro model when auto is requested', () => {
    expect(resolveModel(SPARKLE_MODEL_ALIAS_AUTO)).toBe(DEFAULT_GEMINI_MODEL);
    expect(resolveModel(SPARKLE_MODEL_ALIAS_PRO)).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('should return the Default Flash model when flash is requested', () => {
    expect(resolveModel(SPARKLE_MODEL_ALIAS_FLASH)).toBe(
      DEFAULT_GEMINI_FLASH_MODEL,
    );
  });

  it('should return the Default Flash-Lite model when flash-lite is requested', () => {
    expect(resolveModel(SPARKLE_MODEL_ALIAS_FLASH_LITE)).toBe(
      DEFAULT_GEMINI_FLASH_LITE_MODEL,
    );
  });

  it('should return the requested model as-is for explicit specific models', () => {
    expect(resolveModel(DEFAULT_GEMINI_MODEL)).toBe(DEFAULT_GEMINI_MODEL);
    expect(resolveModel(DEFAULT_GEMINI_FLASH_LITE_MODEL)).toBe(
      DEFAULT_GEMINI_FLASH_LITE_MODEL,
    );
  });

  it('should return a custom model name when requested', () => {
    const customModel = 'custom-model-v1';
    expect(resolveModel(customModel)).toBe(customModel);
  });

  it('should handle non-string inputs gracefully', () => {
    // @ts-expect-error - testing invalid runtime input
    expect(resolveModel(['a', 'b'])).toBe('b');
    // @ts-expect-error - testing invalid runtime input
    expect(resolveModel(true)).toBe('true');
    // @ts-expect-error - testing invalid runtime input
    expect(resolveModel(null)).toBe('');
  });

  it('should keep explicit preview flash selections as-is', () => {
    expect(resolveModel('gemini-3-flash-preview')).toBe(
      'gemini-3-flash-preview',
    );
  });
});

describe('isAutoModel', () => {
  it('should return true for "auto"', () => {
    expect(isAutoModel(SPARKLE_MODEL_ALIAS_AUTO)).toBe(true);
  });

  it('should return false for concrete models', () => {
    expect(isAutoModel(DEFAULT_GEMINI_MODEL)).toBe(false);
    expect(isAutoModel('some-random-model')).toBe(false);
  });
});

describe('resolveClassifierModel', () => {
  it('should return flash model when alias is flash', () => {
    expect(
      resolveClassifierModel(
        SPARKLE_MODEL_ALIAS_AUTO,
        SPARKLE_MODEL_ALIAS_FLASH,
      ),
    ).toBe(DEFAULT_GEMINI_FLASH_MODEL);
  });

  it('should return pro model when alias is pro', () => {
    expect(
      resolveClassifierModel(SPARKLE_MODEL_ALIAS_AUTO, SPARKLE_MODEL_ALIAS_PRO),
    ).toBe(DEFAULT_GEMINI_MODEL);
  });
});

describe('getAutoModelDescription', () => {
  it('should return the default latest models in the description', () => {
    const desc = getAutoModelDescription();
    expect(desc).toContain('gemini-pro-latest');
    expect(desc).toContain('gemini-flash-latest');
  });
});
