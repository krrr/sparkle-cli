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
  supportsModernFeatures,
  isAutoModel,
  getDisplayString,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  supportsMultimodalFunctionResponse,
  GEMINI_MODEL_ALIAS_PRO,
  GEMINI_MODEL_ALIAS_FLASH,
  GEMINI_MODEL_ALIAS_FLASH_LITE,
  GEMINI_MODEL_ALIAS_AUTO,
  isActiveModel,
  isProModel,
  getAutoModelDescription,
} from './models.js';
import type { Config } from './config.js';
import { ModelConfigService } from '../services/modelConfigService.js';
import { DEFAULT_MODEL_CONFIGS } from './defaultModelConfigs.js';

const modelConfigService = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

const dynamicConfig = {
  getExperimentalDynamicModelConfiguration: () => true,
  modelConfigService,
} as unknown as Config;

const legacyConfig = {
  getExperimentalDynamicModelConfiguration: () => false,
  modelConfigService,
} as unknown as Config;

describe('Dynamic Configuration Parity', () => {
  const modelsToTest = [
    GEMINI_MODEL_ALIAS_AUTO,
    GEMINI_MODEL_ALIAS_PRO,
    GEMINI_MODEL_ALIAS_FLASH,
    GEMINI_MODEL_ALIAS_FLASH_LITE,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_GEMINI_FLASH_MODEL,
    'custom-model',
  ];

  it('resolveModel should match legacy behavior when dynamicModelConfiguration flag enabled.', () => {
    for (const model of modelsToTest) {
      const legacy = resolveModel(model, legacyConfig);
      const dynamic = resolveModel(model, dynamicConfig);
      expect(dynamic).toBe(legacy);
    }
  });

  it('resolveClassifierModel should match legacy behavior.', () => {
    const classifierTiers = [GEMINI_MODEL_ALIAS_PRO, GEMINI_MODEL_ALIAS_FLASH];
    const anchorModels = [GEMINI_MODEL_ALIAS_AUTO, DEFAULT_GEMINI_MODEL];

    for (const tier of classifierTiers) {
      for (const anchor of anchorModels) {
        const legacy = resolveClassifierModel(anchor, tier, legacyConfig);
        const dynamic = resolveClassifierModel(anchor, tier, dynamicConfig);
        expect(dynamic).toBe(legacy);
      }
    }
  });

  it('getDisplayString should match legacy behavior', () => {
    for (const model of modelsToTest) {
      const legacy = getDisplayString(model, legacyConfig);
      const dynamic = getDisplayString(model, dynamicConfig);
      expect(dynamic).toBe(legacy);
    }
  });

  it('isProModel should match legacy behavior', () => {
    for (const model of modelsToTest) {
      const legacy = isProModel(model, legacyConfig);
      const dynamic = isProModel(model, dynamicConfig);
      expect(dynamic).toBe(legacy);
    }
  });

  it('isCustomModel should match legacy behavior', () => {
    for (const model of modelsToTest) {
      const legacy = isCustomModel(model, legacyConfig);
      const dynamic = isCustomModel(model, dynamicConfig);
      expect(dynamic).toBe(legacy);
    }
  });

  it('supportsMultimodalFunctionResponse should match legacy behavior', () => {
    for (const model of modelsToTest) {
      const legacy = supportsMultimodalFunctionResponse(model, legacyConfig);
      const dynamic = supportsMultimodalFunctionResponse(model, dynamicConfig);
      expect(dynamic).toBe(legacy);
    }
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
    expect(isCustomModel(GEMINI_MODEL_ALIAS_AUTO)).toBe(false);
    expect(isCustomModel(GEMINI_MODEL_ALIAS_PRO)).toBe(false);
  });

  it('should not throw if the model is an array (e.g. from yargs)', () => {
    // @ts-expect-error - testing invalid runtime input
    expect(() => isCustomModel(['gemini-2.0-flash', 'gpt-4'])).not.toThrow();
    // @ts-expect-error - testing invalid runtime input
    expect(isCustomModel(['gemini-2.0-flash', 'gpt-4'])).toBe(true); // last one is custom
  });
});

describe('supportsModernFeatures', () => {
  it('should return true for all models', () => {
    expect(supportsModernFeatures('gemini-3-pro-preview')).toBe(true);
    expect(supportsModernFeatures('gemini-3-flash-preview')).toBe(true);
    expect(supportsModernFeatures('testing')).toBe(true);
    expect(supportsModernFeatures('some-custom-model')).toBe(true);
    expect(supportsModernFeatures(GEMINI_MODEL_ALIAS_PRO)).toBe(true);
    expect(supportsModernFeatures(GEMINI_MODEL_ALIAS_AUTO)).toBe(true);
  });
});

describe('getDisplayString', () => {
  it('should return concrete model name for pro alias', () => {
    expect(getDisplayString(GEMINI_MODEL_ALIAS_PRO)).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('should return concrete model name for flash alias', () => {
    expect(getDisplayString(GEMINI_MODEL_ALIAS_FLASH)).toBe(
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
    expect(resolveModel(GEMINI_MODEL_ALIAS_AUTO)).toBe(DEFAULT_GEMINI_MODEL);
    expect(resolveModel(GEMINI_MODEL_ALIAS_PRO)).toBe(DEFAULT_GEMINI_MODEL);
  });

  it('should return the Default Flash model when flash is requested', () => {
    expect(resolveModel(GEMINI_MODEL_ALIAS_FLASH)).toBe(
      DEFAULT_GEMINI_FLASH_MODEL,
    );
  });

  it('should return the Default Flash-Lite model when flash-lite is requested', () => {
    expect(resolveModel(GEMINI_MODEL_ALIAS_FLASH_LITE)).toBe(
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

  it('should resolve aliases to the default models via the dynamic config', () => {
    expect(resolveModel(GEMINI_MODEL_ALIAS_AUTO, dynamicConfig)).toBe(
      DEFAULT_GEMINI_MODEL,
    );
    expect(resolveModel(GEMINI_MODEL_ALIAS_PRO, dynamicConfig)).toBe(
      DEFAULT_GEMINI_MODEL,
    );
    expect(resolveModel(GEMINI_MODEL_ALIAS_FLASH, dynamicConfig)).toBe(
      DEFAULT_GEMINI_FLASH_MODEL,
    );
    expect(resolveModel(GEMINI_MODEL_ALIAS_FLASH_LITE, dynamicConfig)).toBe(
      DEFAULT_GEMINI_FLASH_LITE_MODEL,
    );
  });
});

describe('isAutoModel', () => {
  it('should return true for "auto"', () => {
    expect(isAutoModel(GEMINI_MODEL_ALIAS_AUTO)).toBe(true);
  });

  it('should return false for concrete models', () => {
    expect(isAutoModel(DEFAULT_GEMINI_MODEL)).toBe(false);
    expect(isAutoModel('some-random-model')).toBe(false);
  });
});

describe('resolveClassifierModel', () => {
  it('should return flash model when alias is flash', () => {
    expect(
      resolveClassifierModel(GEMINI_MODEL_ALIAS_AUTO, GEMINI_MODEL_ALIAS_FLASH),
    ).toBe(DEFAULT_GEMINI_FLASH_MODEL);
  });

  it('should return pro model when alias is pro', () => {
    expect(
      resolveClassifierModel(GEMINI_MODEL_ALIAS_AUTO, GEMINI_MODEL_ALIAS_PRO),
    ).toBe(DEFAULT_GEMINI_MODEL);
  });
});

describe('isActiveModel', () => {
  it('should return true for valid GA models', () => {
    expect(isActiveModel(DEFAULT_GEMINI_MODEL)).toBe(true);
    expect(isActiveModel(DEFAULT_GEMINI_FLASH_MODEL)).toBe(true);
    expect(isActiveModel(DEFAULT_GEMINI_FLASH_LITE_MODEL)).toBe(true);
  });

  it('should return false for preview and unknown models', () => {
    expect(isActiveModel('gemini-3-pro-preview')).toBe(false);
    expect(isActiveModel('gemini-3.1-pro-preview')).toBe(false);
    expect(isActiveModel('invalid-model')).toBe(false);
    expect(isActiveModel(GEMINI_MODEL_ALIAS_AUTO)).toBe(false);
    expect(isActiveModel('none')).toBe(false);
  });
});

describe('getAutoModelDescription', () => {
  it('should return the default latest models in the description', () => {
    const desc = getAutoModelDescription();
    expect(desc).toContain('gemini-pro-latest');
    expect(desc).toContain('gemini-flash-latest');
  });
});
