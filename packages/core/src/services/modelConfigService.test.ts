/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ThinkingLevel } from '@google/genai';
import {
  DEFAULT_CONTEXT_WINDOW,
  ModelConfigService,
  type ModelConfigAlias,
  type ModelConfigServiceConfig,
} from './modelConfigService.js';
import {
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
} from '../config/models.js';
import { DEFAULT_MODEL_CONFIGS } from '../config/defaultModelConfigs.js';
import { ProviderType } from '../config/constants.js';
import type { ProviderProfile } from '../config/providerProfile.js';

describe('ModelConfigService', () => {
  describe('getContextWindow', () => {
    it('returns the contextWindow declared on the Gemini model definitions', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

      expect(service.getContextWindow(DEFAULT_GEMINI_MODEL)).toBe(1_048_576);
      expect(service.getContextWindow(DEFAULT_GEMINI_FLASH_MODEL)).toBe(
        1_048_576,
      );
    });

    it('resolves model aliases before reading the context window', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

      expect(service.getContextWindow('auto')).toBe(1_048_576);
    });

    it('returns the model-specific contextWindow for profile models', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);
      service.applyProfile({
        id: 'test-profile',
        providerType: ProviderType.USE_OPENAI,
        models: [{ id: 'custom-model', tier: 'flash', contextWindow: 200_000 }],
      });

      expect(service.getContextWindow('custom-model')).toBe(200_000);
    });

    it('falls back to DEFAULT_CONTEXT_WINDOW for models without a definition', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

      expect(service.getContextWindow('totally-unknown-model')).toBe(
        DEFAULT_CONTEXT_WINDOW,
      );
    });
  });

  describe('default model configs (no model-id aliases)', () => {
    const CHAT_BASE_CONFIG = {
      temperature: 1,
      topP: 0.95,
      topK: 64,
      thinkingConfig: {
        includeThoughts: true,
        thinkingLevel: ThinkingLevel.HIGH,
      },
    };

    it('gives chat requests for a default Gemini model the chat-base config via the isChatModel fallback', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

      const resolved = service.getResolvedConfig({
        model: DEFAULT_GEMINI_MODEL,
        isChatModel: true,
      });

      expect(resolved.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(resolved.generateContentConfig).toEqual(CHAT_BASE_CONFIG);
    });

    it('gives non-chat requests for a default Gemini model an empty config', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

      const resolved = service.getResolvedConfig({
        model: DEFAULT_GEMINI_MODEL,
      });

      expect(resolved.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(resolved.generateContentConfig).toEqual({});
    });

    it('gives chat requests for an unrecognized custom model the chat-base config', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

      const resolved = service.getResolvedConfig({
        model: 'my-custom-model',
        isChatModel: true,
      });

      expect(resolved.model).toBe('my-custom-model');
      expect(resolved.generateContentConfig).toEqual(CHAT_BASE_CONFIG);
    });

    it('gives non-chat requests for an unrecognized custom model an empty config', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

      const resolved = service.getResolvedConfig({
        model: 'my-custom-model',
      });

      expect(resolved.model).toBe('my-custom-model');
      expect(resolved.generateContentConfig).toEqual({});
    });
  });

  it('should resolve a basic alias to its model and settings', () => {
    const config: ModelConfigServiceConfig = {
      aliases: {
        classifier: {
          modelConfig: {
            model: 'gemini-1.5-flash-latest',
            generateContentConfig: {
              temperature: 0,
              topP: 0.9,
            },
          },
        },
      },
      overrides: [],
    };
    const service = new ModelConfigService(config);
    const resolved = service.getResolvedConfig({ model: 'classifier' });

    expect(resolved.model).toBe('gemini-1.5-flash-latest');
    expect(resolved.generateContentConfig).toEqual({
      temperature: 0,
      topP: 0.9,
    });
  });

  it('should apply a simple override on top of an alias', () => {
    const config: ModelConfigServiceConfig = {
      aliases: {
        classifier: {
          modelConfig: {
            model: 'gemini-1.5-flash-latest',
            generateContentConfig: {
              temperature: 0,
              topP: 0.9,
            },
          },
        },
      },
      overrides: [
        {
          match: { model: 'classifier' },
          modelConfig: {
            generateContentConfig: {
              temperature: 0.5,
              maxOutputTokens: 1000,
            },
          },
        },
      ],
    };
    const service = new ModelConfigService(config);
    const resolved = service.getResolvedConfig({ model: 'classifier' });

    expect(resolved.model).toBe('gemini-1.5-flash-latest');
    expect(resolved.generateContentConfig).toEqual({
      temperature: 0.5,
      topP: 0.9,
      maxOutputTokens: 1000,
    });
  });

  it('should apply the most specific override rule', () => {
    const config: ModelConfigServiceConfig = {
      aliases: {},
      overrides: [
        {
          match: { model: 'gemini-pro' },
          modelConfig: { generateContentConfig: { temperature: 0.5 } },
        },
        {
          match: { model: 'gemini-pro', overrideScope: 'my-agent' },
          modelConfig: { generateContentConfig: { temperature: 0.1 } },
        },
      ],
    };
    const service = new ModelConfigService(config);
    const resolved = service.getResolvedConfig({
      model: 'gemini-pro',
      overrideScope: 'my-agent',
    });

    expect(resolved.model).toBe('gemini-pro');
    expect(resolved.generateContentConfig).toEqual({ temperature: 0.1 });
  });

  it('should use the last override in case of a tie in specificity', () => {
    const config: ModelConfigServiceConfig = {
      aliases: {},
      overrides: [
        {
          match: { model: 'gemini-pro' },
          modelConfig: {
            generateContentConfig: { temperature: 0.5, topP: 0.8 },
          },
        },
        {
          match: { model: 'gemini-pro' },
          modelConfig: { generateContentConfig: { temperature: 0.1 } },
        },
      ],
    };
    const service = new ModelConfigService(config);
    const resolved = service.getResolvedConfig({ model: 'gemini-pro' });

    expect(resolved.model).toBe('gemini-pro');
    expect(resolved.generateContentConfig).toEqual({
      temperature: 0.1,
      topP: 0.8,
    });
  });

  it('should correctly pass through generation config from an alias', () => {
    const config: ModelConfigServiceConfig = {
      aliases: {
        'thinking-alias': {
          modelConfig: {
            model: 'gemini-pro',
            generateContentConfig: {
              candidateCount: 500,
            },
          },
        },
      },
      overrides: [],
    };
    const service = new ModelConfigService(config);
    const resolved = service.getResolvedConfig({ model: 'thinking-alias' });

    expect(resolved.generateContentConfig).toEqual({ candidateCount: 500 });
  });

  it('should let an override generation config win over an alias config', () => {
    const config: ModelConfigServiceConfig = {
      aliases: {
        'thinking-alias': {
          modelConfig: {
            model: 'gemini-pro',
            generateContentConfig: {
              candidateCount: 500,
            },
          },
        },
      },
      overrides: [
        {
          match: { model: 'thinking-alias' },
          modelConfig: {
            generateContentConfig: {
              candidateCount: 1000,
            },
          },
        },
      ],
    };
    const service = new ModelConfigService(config);
    const resolved = service.getResolvedConfig({ model: 'thinking-alias' });

    expect(resolved.generateContentConfig).toEqual({
      candidateCount: 1000,
    });
  });

  it('should merge settings from global, alias, and multiple matching overrides', () => {
    const config: ModelConfigServiceConfig = {
      aliases: {
        'test-alias': {
          modelConfig: {
            model: 'sparkle-test-model',
            generateContentConfig: {
              topP: 0.9,
              topK: 50,
            },
          },
        },
      },
      overrides: [
        {
          match: { model: 'sparkle-test-model' },
          modelConfig: {
            generateContentConfig: {
              topK: 40,
              maxOutputTokens: 2048,
            },
          },
        },
        {
          match: { overrideScope: 'test-agent' },
          modelConfig: {
            generateContentConfig: {
              maxOutputTokens: 4096,
            },
          },
        },
        {
          match: { model: 'sparkle-test-model', overrideScope: 'test-agent' },
          modelConfig: {
            generateContentConfig: {
              temperature: 0.2,
            },
          },
        },
      ],
    };

    const service = new ModelConfigService(config);
    const resolved = service.getResolvedConfig({
      model: 'test-alias',
      overrideScope: 'test-agent',
    });

    expect(resolved.model).toBe('sparkle-test-model');
    expect(resolved.generateContentConfig).toEqual({
      // From global, overridden by most specific override
      temperature: 0.2,
      // From alias, not overridden
      topP: 0.9,
      // From alias, overridden by less specific override
      topK: 40,
      // From first matching override, overridden by second matching override
      maxOutputTokens: 4096,
    });
  });

  it('should match an agent:core override when agent is undefined', () => {
    const config: ModelConfigServiceConfig = {
      aliases: {},
      overrides: [
        {
          match: { overrideScope: 'core' },
          modelConfig: {
            generateContentConfig: {
              temperature: 0.1,
            },
          },
        },
      ],
    };

    const service = new ModelConfigService(config);
    const resolved = service.getResolvedConfig({
      model: 'gemini-pro',
      overrideScope: undefined, // Explicitly undefined
    });

    expect(resolved.model).toBe('gemini-pro');
    expect(resolved.generateContentConfig).toEqual({
      temperature: 0.1,
    });
  });

  describe('alias inheritance', () => {
    it('should resolve a simple "extends" chain', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          base: {
            modelConfig: {
              model: 'gemini-1.5-pro-latest',
              generateContentConfig: {
                temperature: 0.7,
                topP: 0.9,
              },
            },
          },
          'flash-variant': {
            extends: 'base',
            modelConfig: {
              model: 'gemini-1.5-flash-latest',
            },
          },
        },
      };
      const service = new ModelConfigService(config);
      const resolved = service.getResolvedConfig({ model: 'flash-variant' });

      expect(resolved.model).toBe('gemini-1.5-flash-latest');
      expect(resolved.generateContentConfig).toEqual({
        temperature: 0.7,
        topP: 0.9,
      });
    });

    it('should override parent properties from child alias', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          base: {
            modelConfig: {
              model: 'gemini-1.5-pro-latest',
              generateContentConfig: {
                temperature: 0.7,
                topP: 0.9,
              },
            },
          },
          'flash-variant': {
            extends: 'base',
            modelConfig: {
              model: 'gemini-1.5-flash-latest',
              generateContentConfig: {
                temperature: 0.2,
              },
            },
          },
        },
      };
      const service = new ModelConfigService(config);
      const resolved = service.getResolvedConfig({ model: 'flash-variant' });

      expect(resolved.model).toBe('gemini-1.5-flash-latest');
      expect(resolved.generateContentConfig).toEqual({
        temperature: 0.2,
        topP: 0.9,
      });
    });

    it('should resolve a multi-level "extends" chain', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          base: {
            modelConfig: {
              model: 'gemini-1.5-pro-latest',
              generateContentConfig: {
                temperature: 0.7,
                topP: 0.9,
              },
            },
          },
          'base-flash': {
            extends: 'base',
            modelConfig: {
              model: 'gemini-1.5-flash-latest',
            },
          },
          'classifier-flash': {
            extends: 'base-flash',
            modelConfig: {
              generateContentConfig: {
                temperature: 0,
              },
            },
          },
        },
      };
      const service = new ModelConfigService(config);
      const resolved = service.getResolvedConfig({
        model: 'classifier-flash',
      });

      expect(resolved.model).toBe('gemini-1.5-flash-latest');
      expect(resolved.generateContentConfig).toEqual({
        temperature: 0,
        topP: 0.9,
      });
    });

    it('should throw an error for circular dependencies', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          a: { extends: 'b', modelConfig: {} },
          b: { extends: 'a', modelConfig: {} },
        },
      };
      const service = new ModelConfigService(config);
      expect(() => service.getResolvedConfig({ model: 'a' })).toThrow(
        'Circular alias dependency: a -> b -> a',
      );
    });

    describe('abstract aliases', () => {
      it('should allow an alias to extend an abstract alias without a model', () => {
        const config: ModelConfigServiceConfig = {
          aliases: {
            'abstract-base': {
              modelConfig: {
                generateContentConfig: {
                  temperature: 0.1,
                },
              },
            },
            'concrete-child': {
              extends: 'abstract-base',
              modelConfig: {
                model: 'gemini-1.5-pro-latest',
                generateContentConfig: {
                  topP: 0.9,
                },
              },
            },
          },
        };
        const service = new ModelConfigService(config);
        const resolved = service.getResolvedConfig({ model: 'concrete-child' });

        expect(resolved.model).toBe('gemini-1.5-pro-latest');
        expect(resolved.generateContentConfig).toEqual({
          temperature: 0.1,
          topP: 0.9,
        });
      });

      it('should throw an error if a resolved alias chain has no model', () => {
        const config: ModelConfigServiceConfig = {
          aliases: {
            'abstract-base': {
              modelConfig: {
                generateContentConfig: { temperature: 0.7 },
              },
            },
          },
        };
        const service = new ModelConfigService(config);
        expect(() =>
          service.getResolvedConfig({ model: 'abstract-base' }),
        ).toThrow(
          'Could not resolve a model name for alias "abstract-base". Please ensure the alias chain or a matching override specifies a model.',
        );
      });

      it('should resolve an abstract alias if an override provides the model', () => {
        const config: ModelConfigServiceConfig = {
          aliases: {
            'abstract-base': {
              modelConfig: {
                generateContentConfig: {
                  temperature: 0.1,
                },
              },
            },
          },
          overrides: [
            {
              match: { model: 'abstract-base' },
              modelConfig: {
                model: 'gemini-1.5-flash-latest',
              },
            },
          ],
        };
        const service = new ModelConfigService(config);
        const resolved = service.getResolvedConfig({ model: 'abstract-base' });

        expect(resolved.model).toBe('gemini-1.5-flash-latest');
        expect(resolved.generateContentConfig).toEqual({
          temperature: 0.1,
        });
      });
    });

    it('should throw an error if an extended alias does not exist', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          'bad-alias': {
            extends: 'non-existent',
            modelConfig: {},
          },
        },
      };
      const service = new ModelConfigService(config);
      expect(() => service.getResolvedConfig({ model: 'bad-alias' })).toThrow(
        'Alias "non-existent" not found.',
      );
    });

    it('should throw an error if the alias chain is too deep', () => {
      const aliases: Record<string, ModelConfigAlias> = {};
      for (let i = 0; i < 101; i++) {
        aliases[`alias-${i}`] = {
          extends: i === 100 ? undefined : `alias-${i + 1}`,
          modelConfig: i === 100 ? { model: 'gemini-pro' } : {},
        };
      }
      const config: ModelConfigServiceConfig = { aliases };
      const service = new ModelConfigService(config);
      expect(() => service.getResolvedConfig({ model: 'alias-0' })).toThrow(
        'Alias inheritance chain exceeded maximum depth of 100.',
      );
    });
  });

  describe('deep merging', () => {
    it('should deep merge nested config objects from aliases and overrides', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          'base-safe': {
            modelConfig: {
              model: 'gemini-pro',
              generateContentConfig: {
                safetySettings: {
                  HARM_CATEGORY_HARASSMENT: 'BLOCK_ONLY_HIGH',
                  HARM_CATEGORY_HATE_SPEECH: 'BLOCK_ONLY_HIGH',
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any,
              },
            },
          },
        },
        overrides: [
          {
            match: { model: 'base-safe' },
            modelConfig: {
              generateContentConfig: {
                safetySettings: {
                  HARM_CATEGORY_HATE_SPEECH: 'BLOCK_NONE',
                  HARM_CATEGORY_SEXUALLY_EXPLICIT: 'BLOCK_MEDIUM_AND_ABOVE',
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                } as any,
              },
            },
          },
        ],
      };
      const service = new ModelConfigService(config);
      const resolved = service.getResolvedConfig({ model: 'base-safe' });

      expect(resolved.model).toBe('gemini-pro');
      expect(resolved.generateContentConfig.safetySettings).toEqual({
        // From alias
        HARM_CATEGORY_HARASSMENT: 'BLOCK_ONLY_HIGH',
        // From alias, overridden by override
        HARM_CATEGORY_HATE_SPEECH: 'BLOCK_NONE',
        // From override
        HARM_CATEGORY_SEXUALLY_EXPLICIT: 'BLOCK_MEDIUM_AND_ABOVE',
      });
    });

    it('should not deeply merge merge arrays from aliases and overrides', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          base: {
            modelConfig: {
              model: 'gemini-pro',
              generateContentConfig: {
                stopSequences: ['foo'],
              },
            },
          },
        },
        overrides: [
          {
            match: { model: 'base' },
            modelConfig: {
              generateContentConfig: {
                stopSequences: ['overrideFoo'],
              },
            },
          },
        ],
      };
      const service = new ModelConfigService(config);
      const resolved = service.getResolvedConfig({ model: 'base' });

      expect(resolved.model).toBe('gemini-pro');
      expect(resolved.generateContentConfig.stopSequences).toEqual([
        'overrideFoo',
      ]);
    });
  });

  describe('runtime aliases', () => {
    it('should resolve a simple runtime-registered alias', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {},
        overrides: [],
      };
      const service = new ModelConfigService(config);

      service.registerRuntimeModelConfig('runtime-alias', {
        modelConfig: {
          model: 'sparkle-runtime-model',
          generateContentConfig: {
            temperature: 0.123,
          },
        },
      });

      const resolved = service.getResolvedConfig({ model: 'runtime-alias' });

      expect(resolved.model).toBe('sparkle-runtime-model');
      expect(resolved.generateContentConfig).toEqual({
        temperature: 0.123,
      });
    });
  });

  describe('runtime overrides', () => {
    it('should resolve a simple runtime-registered override', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {},
        overrides: [],
      };
      const service = new ModelConfigService(config);

      service.registerRuntimeModelOverride({
        match: { model: 'gemini-pro' },
        modelConfig: {
          generateContentConfig: {
            temperature: 0.99,
          },
        },
      });

      const resolved = service.getResolvedConfig({ model: 'gemini-pro' });

      expect(resolved.model).toBe('gemini-pro');
      expect(resolved.generateContentConfig.temperature).toBe(0.99);
    });

    it('should prioritize runtime overrides over default overrides when they have the same specificity', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {},
        overrides: [
          {
            match: { model: 'gemini-pro' },
            modelConfig: { generateContentConfig: { temperature: 0.1 } },
          },
        ],
      };
      const service = new ModelConfigService(config);

      service.registerRuntimeModelOverride({
        match: { model: 'gemini-pro' },
        modelConfig: { generateContentConfig: { temperature: 0.9 } },
      });

      const resolved = service.getResolvedConfig({ model: 'gemini-pro' });

      // Runtime overrides are appended after overrides/customOverrides, so they should win.
      expect(resolved.generateContentConfig.temperature).toBe(0.9);
    });

    it('should still respect specificity with runtime overrides', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {},
        overrides: [],
      };
      const service = new ModelConfigService(config);

      // Register a more specific runtime override
      service.registerRuntimeModelOverride({
        match: { model: 'gemini-pro', overrideScope: 'my-agent' },
        modelConfig: { generateContentConfig: { temperature: 0.1 } },
      });

      // Register a less specific runtime override later
      service.registerRuntimeModelOverride({
        match: { model: 'gemini-pro' },
        modelConfig: { generateContentConfig: { temperature: 0.9 } },
      });

      const resolved = service.getResolvedConfig({
        model: 'gemini-pro',
        overrideScope: 'my-agent',
      });

      // Specificity should win over order
      expect(resolved.generateContentConfig.temperature).toBe(0.1);
    });

    it('should clear runtime overrides', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {},
        overrides: [],
      };
      const service = new ModelConfigService(config);

      service.registerRuntimeModelOverride({
        match: { model: 'gemini-pro' },
        modelConfig: { generateContentConfig: { temperature: 0.99 } },
      });

      expect(
        service.getResolvedConfig({ model: 'gemini-pro' }).generateContentConfig
          .temperature,
      ).toBe(0.99);

      service.clearRuntimeOverrides();

      expect(
        service.getResolvedConfig({ model: 'gemini-pro' }).generateContentConfig
          .temperature,
      ).toBeUndefined();
    });
  });

  describe('custom aliases', () => {
    it('should resolve a custom alias', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {},
        customAliases: {
          'my-custom-alias': {
            modelConfig: {
              model: 'gemini-custom',
              generateContentConfig: {
                temperature: 0.9,
              },
            },
          },
        },
        overrides: [],
      };
      const service = new ModelConfigService(config);
      const resolved = service.getResolvedConfig({ model: 'my-custom-alias' });

      expect(resolved.model).toBe('gemini-custom');
      expect(resolved.generateContentConfig).toEqual({
        temperature: 0.9,
      });
    });

    it('should allow custom aliases to override built-in aliases', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          'standard-alias': {
            modelConfig: {
              model: 'gemini-standard',
              generateContentConfig: {
                temperature: 0.5,
              },
            },
          },
        },
        customAliases: {
          'standard-alias': {
            modelConfig: {
              model: 'gemini-custom-override',
              generateContentConfig: {
                temperature: 0.1,
              },
            },
          },
        },
        overrides: [],
      };
      const service = new ModelConfigService(config);
      const resolved = service.getResolvedConfig({ model: 'standard-alias' });

      expect(resolved.model).toBe('gemini-custom-override');
      expect(resolved.generateContentConfig).toEqual({
        temperature: 0.1,
      });
    });
  });

  describe('fallback behavior', () => {
    it('should fallback to chat-base if the requested model is completely unknown', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          'chat-base': {
            modelConfig: {
              model: 'default-fallback-model',
              generateContentConfig: {
                temperature: 0.99,
              },
            },
          },
        },
      };
      const service = new ModelConfigService(config);
      const resolved = service.getResolvedConfig({
        model: 'my-custom-model',
        isChatModel: true,
      });

      // It preserves the requested model name, but inherits the config from chat-base
      expect(resolved.model).toBe('my-custom-model');
      expect(resolved.generateContentConfig).toEqual({
        temperature: 0.99,
      });
    });

    it('should return empty config if requested model is unknown and chat-base is not defined', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {},
      };
      const service = new ModelConfigService(config);
      const resolved = service.getResolvedConfig({
        model: 'my-custom-model',
        isChatModel: true,
      });

      expect(resolved.model).toBe('my-custom-model');
      expect(resolved.generateContentConfig).toEqual({});
    });

    it('should NOT fallback to chat-base if the requested model is completely unknown but isChatModel is false', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          'chat-base': {
            modelConfig: {
              model: 'default-fallback-model',
              generateContentConfig: {
                temperature: 0.99,
              },
            },
          },
        },
      };
      const service = new ModelConfigService(config);
      const resolved = service.getResolvedConfig({
        model: 'my-custom-model',
        isChatModel: false,
      });

      expect(resolved.model).toBe('my-custom-model');
      expect(resolved.generateContentConfig).toEqual({});
    });
  });

  describe('unrecognized models', () => {
    it('should apply overrides to unrecognized model names', () => {
      const unregisteredModelName = 'my-unregistered-model-v1';
      const config: ModelConfigServiceConfig = {
        aliases: {}, // No aliases defined
        overrides: [
          {
            match: { model: unregisteredModelName },
            modelConfig: {
              generateContentConfig: {
                temperature: 0.01,
              },
            },
          },
        ],
      };
      const service = new ModelConfigService(config);

      // Request the unregistered model directly
      const resolved = service.getResolvedConfig({
        model: unregisteredModelName,
      });

      // It should preserve the model name and apply the override
      expect(resolved.model).toBe(unregisteredModelName);
      expect(resolved.generateContentConfig).toEqual({
        temperature: 0.01,
      });
    });

    it('should apply scoped overrides to unrecognized model names', () => {
      const unregisteredModelName = 'my-unregistered-model-v1';
      const config: ModelConfigServiceConfig = {
        aliases: {},
        overrides: [
          {
            match: {
              model: unregisteredModelName,
              overrideScope: 'special-agent',
            },
            modelConfig: {
              generateContentConfig: {
                temperature: 0.99,
              },
            },
          },
        ],
      };
      const service = new ModelConfigService(config);

      const resolved = service.getResolvedConfig({
        model: unregisteredModelName,
        overrideScope: 'special-agent',
      });

      expect(resolved.model).toBe(unregisteredModelName);
      expect(resolved.generateContentConfig).toEqual({
        temperature: 0.99,
      });
    });
  });

  describe('custom overrides', () => {
    it('should apply custom overrides on top of defaults', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          'test-alias': {
            modelConfig: {
              model: 'gemini-test',
              generateContentConfig: { temperature: 0.5 },
            },
          },
        },
        overrides: [
          {
            match: { model: 'test-alias' },
            modelConfig: { generateContentConfig: { temperature: 0.6 } },
          },
        ],
        customOverrides: [
          {
            match: { model: 'test-alias' },
            modelConfig: { generateContentConfig: { temperature: 0.7 } },
          },
        ],
      };
      const service = new ModelConfigService(config);
      const resolved = service.getResolvedConfig({ model: 'test-alias' });

      // Custom overrides should be appended to overrides, so they win
      expect(resolved.generateContentConfig.temperature).toBe(0.7);
    });
  });

  describe('retry behavior', () => {
    it('should apply retry-specific overrides when isRetry is true', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          'test-model': {
            modelConfig: {
              model: 'gemini-test',
              generateContentConfig: {
                temperature: 0.5,
              },
            },
          },
        },
        overrides: [
          {
            match: { model: 'test-model', isRetry: true },
            modelConfig: {
              generateContentConfig: {
                temperature: 1.0,
              },
            },
          },
        ],
      };
      const service = new ModelConfigService(config);

      // Normal request
      const normal = service.getResolvedConfig({ model: 'test-model' });
      expect(normal.generateContentConfig.temperature).toBe(0.5);

      // Retry request
      const retry = service.getResolvedConfig({
        model: 'test-model',
        isRetry: true,
      });
      expect(retry.generateContentConfig.temperature).toBe(1.0);
    });

    it('should prioritize retry overrides over generic overrides', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          'test-model': {
            modelConfig: {
              model: 'gemini-test',
              generateContentConfig: {
                temperature: 0.5,
              },
            },
          },
        },
        overrides: [
          // Generic override for this model
          {
            match: { model: 'test-model' },
            modelConfig: {
              generateContentConfig: {
                temperature: 0.7,
              },
            },
          },
          // Retry-specific override
          {
            match: { model: 'test-model', isRetry: true },
            modelConfig: {
              generateContentConfig: {
                temperature: 1.0,
              },
            },
          },
        ],
      };
      const service = new ModelConfigService(config);

      // Normal request - hits generic override
      const normal = service.getResolvedConfig({ model: 'test-model' });
      expect(normal.generateContentConfig.temperature).toBe(0.7);

      // Retry request - hits retry override (more specific)
      const retry = service.getResolvedConfig({
        model: 'test-model',
        isRetry: true,
      });
      expect(retry.generateContentConfig.temperature).toBe(1.0);
    });

    it('should apply overrides to parents in the alias hierarchy', () => {
      const config: ModelConfigServiceConfig = {
        aliases: {
          'base-alias': {
            modelConfig: {
              model: 'gemini-test',
              generateContentConfig: {
                temperature: 0.5,
              },
            },
          },
          'child-alias': {
            extends: 'base-alias',
            modelConfig: {
              generateContentConfig: {
                topP: 0.9,
              },
            },
          },
        },
        overrides: [
          {
            match: { model: 'base-alias', isRetry: true },
            modelConfig: {
              generateContentConfig: {
                temperature: 1.0,
              },
            },
          },
        ],
      };
      const service = new ModelConfigService(config);

      // Normal request
      const normal = service.getResolvedConfig({ model: 'child-alias' });
      expect(normal.generateContentConfig.temperature).toBe(0.5);

      // Retry request - should match override on parent
      const retry = service.getResolvedConfig({
        model: 'child-alias',
        isRetry: true,
      });
      expect(retry.generateContentConfig.temperature).toBe(1.0);
    });
  });

  // Resolves a model ID to a concrete model ID based on the provided context.
  describe('resolveModelId', () => {
    it('should resolve based on requestedModels condition', () => {
      const config: ModelConfigServiceConfig = {
        modelIdResolutions: {
          'gemini-flash': {
            default: 'gemini-2.5-flash',
            contexts: [
              {
                condition: { requestedModels: ['gemini-2.5-pro'] },
                target: 'gemini-2.5-flash',
              },
            ],
          },
        },
      };
      const service = new ModelConfigService(config);

      // Case 1: Requested model matches
      expect(
        service.resolveModelId('gemini-flash', {
          requestedModel: 'gemini-2.5-pro',
        }),
      ).toBe('gemini-2.5-flash');

      // Case 2: No conditions met
      expect(
        service.resolveModelId('gemini-flash', {
          requestedModel: 'gemini-2.5-flash',
        }),
      ).toBe('gemini-2.5-flash');
    });

    it('should recompile resolutions and definitions when applyProfile is called', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

      const openAiProfile: ProviderProfile = {
        id: 'openai-profile',
        providerType: ProviderType.USE_OPENAI,
        models: [
          { id: DEFAULT_OPENAI_MODEL, tier: 'pro' },
          { id: 'gpt-4o-mini', tier: 'flash' },
        ],
        defaultModel: DEFAULT_OPENAI_MODEL,
      };

      service.applyProfile(openAiProfile);

      // Model resolutions under OpenAI profile
      expect(service.resolveModelId('pro')).toBe(DEFAULT_OPENAI_MODEL);
      expect(service.resolveModelId('flash')).toBe('gpt-4o-mini');
      expect(service.resolveModelId('flash-lite')).toBe('gpt-4o-mini');
      expect(service.resolveModelId('auto')).toBe(DEFAULT_OPENAI_MODEL);
      expect(
        service.resolveClassifierModelId('flash', DEFAULT_OPENAI_MODEL),
      ).toBe('gpt-4o-mini');

      // Chains resolve through the recompiled config
      const chain = service.resolveChain('auto-default');
      expect(chain?.[0]?.model).toBe(DEFAULT_OPENAI_MODEL);
      expect(chain?.[1]?.model).toBe('gpt-4o-mini');

      // Reset back to Gemini
      service.applyProfile(undefined);
      expect(service.resolveModelId('pro')).toBe(DEFAULT_GEMINI_MODEL);
      expect(service.resolveModelId('flash')).toBe(DEFAULT_GEMINI_FLASH_MODEL);
    });

    it('should not resolve aliases to themselves when defaultModel is an alias name', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

      const profile: ProviderProfile = {
        id: 'alias-default-profile',
        providerType: ProviderType.USE_OPENAI,
        models: [{ id: 'gpt-4o-mini', tier: 'flash' }],
        defaultModel: 'auto',
      };

      service.applyProfile(profile);

      // 'auto' must fall through to the tier/listed model, never resolve to
      // the literal string 'auto'.
      expect(service.resolveModelId('auto')).toBe('gpt-4o-mini');
      // Without a pro-tier model, 'pro' falls back to the first listed model.
      expect(service.resolveModelId('pro')).toBe('gpt-4o-mini');
      expect(service.resolveModelId('flash')).toBe('gpt-4o-mini');
      expect(service.resolveClassifierModelId('flash', 'gpt-4o-mini')).toBe(
        'gpt-4o-mini',
      );
    });

    it('should treat models without tiers as custom definitions', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

      const profile: ProviderProfile = {
        id: 'no-tier-profile',
        providerType: ProviderType.USE_OPENAI,
        models: [{ id: 'my-model' }, { id: 'other-model' }],
      };

      service.applyProfile(profile);

      // With no tier assignments and no defaultModel, every tier alias
      // falls back to the first listed model.
      expect(service.resolveModelId('pro')).toBe('my-model');
      expect(service.resolveModelId('flash')).toBe('my-model');
      expect(service.resolveModelId('flash-lite')).toBe('my-model');
      expect(service.resolveModelId('auto')).toBe('my-model');

      expect(service.getModelDefinition('my-model')?.tier).toBe('custom');
      expect(service.getModelDefinition('other-model')?.tier).toBe('custom');
    });

    it('should propagate contextWindow and features into model definitions', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

      const profile: ProviderProfile = {
        id: 'features-profile',
        providerType: ProviderType.USE_OPENAI,
        models: [
          {
            id: 'reasoner-v1',
            features: { thinking: false },
            contextWindow: 64000,
          },
          { id: 'fallback-model' },
        ],
        defaultModel: 'reasoner-v1',
      };

      service.applyProfile(profile);

      const definition = service.getModelDefinition('reasoner-v1');
      expect(definition?.contextWindow).toBe(64000);
      // Explicit feature flags are taken as-is.
      expect(definition?.features).toEqual({ thinking: false });
      // Models without explicit features get the documented defaults.
      expect(service.getModelDefinition('fallback-model')?.features).toEqual({
        thinking: true,
        multimodalToolUse: false,
      });
    });

    it('should apply per-model generateConfig via model-matched overrides', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);

      const profile: ProviderProfile = {
        id: 'effort-profile',
        providerType: ProviderType.USE_OPENAI,
        models: [
          {
            id: 'reasoner-v1',
            generateConfig: { reasoningEffort: 'high' },
          },
          {
            id: 'cheap-v1',
            generateConfig: { temperature: 0.2, topP: 0.8 },
          },
          { id: 'plain-v1' },
        ],
        defaultModel: 'reasoner-v1',
      };

      service.applyProfile(profile);

      // Chat-keyed requests pick up the effort through openaiExtraBody,
      // layered on top of the chat-base fallback config.
      const reasoned = service.getResolvedConfig({
        model: 'reasoner-v1',
        isChatModel: true,
      });
      expect(reasoned.generateContentConfig.openaiExtraBody).toEqual({
        reasoning_effort: 'high',
      });
      expect(reasoned.generateContentConfig.thinkingConfig).toBeDefined();

      // Sampling parameters pass through alongside the effort.
      const sampled = service.getResolvedConfig({
        model: 'cheap-v1',
        isChatModel: true,
      });
      expect(sampled.generateContentConfig.temperature).toBe(0.2);
      expect(sampled.generateContentConfig.topP).toBe(0.8);

      // Models without a generateConfig keep the plain fallback config.
      const plain = service.getResolvedConfig({
        model: 'plain-v1',
        isChatModel: true,
      });
      expect(plain.generateContentConfig.openaiExtraBody).toBeUndefined();

      // Non-chat requests keyed by the model id also receive the effort,
      // without inheriting chat-base sampling params.
      const subagent = service.getResolvedConfig({ model: 'reasoner-v1' });
      expect(subagent.generateContentConfig.openaiExtraBody).toEqual({
        reasoning_effort: 'high',
      });
      expect(subagent.generateContentConfig.temperature).toBeUndefined();

      // Resetting the profile clears the dynamic overrides.
      service.applyProfile(undefined);
      const reset = service.getResolvedConfig({
        model: 'reasoner-v1',
        isChatModel: true,
      });
      expect(reset.generateContentConfig.openaiExtraBody).toBeUndefined();
    });

    it('should let user customOverrides win over profile generateConfig', () => {
      const service = new ModelConfigService({
        ...DEFAULT_MODEL_CONFIGS,
        customOverrides: [
          {
            match: { model: 'reasoner-v1' },
            modelConfig: {
              generateContentConfig: {
                openaiExtraBody: { reasoning_effort: 'low' },
              },
            },
          },
        ],
      });

      service.applyProfile({
        id: 'effort-profile',
        providerType: ProviderType.USE_OPENAI,
        models: [
          { id: 'reasoner-v1', generateConfig: { reasoningEffort: 'high' } },
        ],
        defaultModel: 'reasoner-v1',
      });

      const resolved = service.getResolvedConfig({
        model: 'reasoner-v1',
        isChatModel: true,
      });
      expect(resolved.generateContentConfig.openaiExtraBody).toEqual({
        reasoning_effort: 'low',
      });
    });
  });

  describe('getAvailableModelOptions', () => {
    it('should include models', () => {
      const config: ModelConfigServiceConfig = {
        modelDefinitions: {
          'gemini-3-pro': { isVisible: true, tier: 'pro' },
        },
      };
      const service = new ModelConfigService(config);

      const optionsWithTrue = service.getAvailableModelOptions({});
      expect(optionsWithTrue.map((o) => o.modelId)).toContain('gemini-3-pro');

      const optionsWithUndefined = service.getAvailableModelOptions({});
      expect(optionsWithUndefined.map((o) => o.modelId)).toContain(
        'gemini-3-pro',
      );
    });
  });

  describe('model chains', () => {
    it('pins the retry semantics of the auto-default chain', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);
      const chain = service.resolveChain('auto-default');
      expect(chain).toHaveLength(2);

      const [primary, lastResort] = chain ?? [];
      expect(primary).toBeDefined();
      expect(lastResort).toBeDefined();
      expect(primary?.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(primary?.maxAttempts).toBe(3);
      expect(primary?.actions.transient).toBe('silent');
      expect(primary?.stateTransitions.transient).toBe('sticky_retry');
      expect(lastResort?.model).toBe(DEFAULT_GEMINI_FLASH_MODEL);
      expect(lastResort?.isLastResort).toBe(true);
      expect(lastResort?.maxAttempts).toBe(10);
    });

    it('clones policy maps so edits do not leak between calls', () => {
      const service = new ModelConfigService(DEFAULT_MODEL_CONFIGS);
      const firstCall = service.resolveChain('default');
      const secondCall = service.resolveChain('default');
      expect(firstCall).toBeDefined();
      expect(secondCall).toBeDefined();

      const firstPolicy = firstCall?.[0];
      const secondPolicy = secondCall?.[0];
      expect(firstPolicy).toBeDefined();
      expect(secondPolicy).toBeDefined();
      if (firstPolicy && secondPolicy) {
        firstPolicy.actions.terminal = 'silent';
        expect(secondPolicy.actions.terminal).toBe('prompt');
      }
      expect(
        DEFAULT_MODEL_CONFIGS.modelChains?.['default']?.[0]?.actions.terminal,
      ).toBe('prompt');
    });
  });
});
