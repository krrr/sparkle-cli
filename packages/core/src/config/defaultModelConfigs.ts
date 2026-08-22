/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ThinkingLevel } from '@google/genai';
import type { ModelConfigServiceConfig } from '../services/modelConfigService.js';
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
} from './models.js';

// The default model configs. We use `base` as the parent for all of our model
// configs, while `chat-base`, a child of `base`, is the parent of the models
// we use in the "chat" experience.
export const DEFAULT_MODEL_CONFIGS: ModelConfigServiceConfig = {
  aliases: {
    base: {
      modelConfig: {
        generateContentConfig: {
          temperature: 0,
          topP: 1,
        },
      },
    },
    'chat-base': {
      extends: 'base',
      modelConfig: {
        generateContentConfig: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: ThinkingLevel.HIGH,
          },
          temperature: 1,
          topP: 0.95,
          topK: 64,
        },
      },
    },
    [DEFAULT_GEMINI_MODEL]: {
      extends: 'chat-base',
      modelConfig: {
        model: DEFAULT_GEMINI_MODEL,
      },
    },
    [DEFAULT_GEMINI_FLASH_LITE_MODEL]: {
      extends: 'chat-base',
      modelConfig: {
        model: DEFAULT_GEMINI_FLASH_LITE_MODEL,
      },
    },
    [DEFAULT_GEMINI_FLASH_MODEL]: {
      extends: 'chat-base',
      modelConfig: {
        model: DEFAULT_GEMINI_FLASH_MODEL,
      },
    },

    'internal-tool-flash': {
      extends: 'base',
      modelConfig: {
        model: 'flash',
      },
    },
    classifier: {
      extends: 'base',
      modelConfig: {
        model: 'flash-lite',
        generateContentConfig: {
          maxOutputTokens: 1024,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
        },
      },
    },
    'prompt-completion': {
      extends: 'base',
      modelConfig: {
        model: 'flash-lite',
        generateContentConfig: {
          temperature: 0.3,
          maxOutputTokens: 16000,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
        },
      },
    },
    'fast-ack-helper': {
      extends: 'base',
      modelConfig: {
        model: 'flash-lite',
        generateContentConfig: {
          temperature: 0.2,
          maxOutputTokens: 120,
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
        },
      },
    },
    'edit-corrector': {
      extends: 'base',
      modelConfig: {
        model: 'flash-lite',
        generateContentConfig: {
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.LOW,
          },
        },
      },
    },
    'summarizer-default': {
      extends: 'base',
      modelConfig: {
        model: 'flash-lite',
        generateContentConfig: {
          maxOutputTokens: 2000,
        },
      },
    },
    'summarizer-shell': {
      extends: 'base',
      modelConfig: {
        model: 'flash-lite',
        generateContentConfig: {
          maxOutputTokens: 2000,
        },
      },
    },
    'web-search': {
      extends: 'internal-tool-flash',
      modelConfig: {
        generateContentConfig: {
          tools: [{ googleSearch: {} }],
        },
      },
    },
    'web-fetch': {
      extends: 'internal-tool-flash',
      modelConfig: {
        generateContentConfig: {
          tools: [{ urlContext: {} }],
        },
      },
    },
    // TODO(joshualitt): During cleanup, make modelConfig optional.
    'web-fetch-fallback': {
      extends: 'internal-tool-flash',
      modelConfig: {},
    },
    'loop-detection': {
      extends: 'internal-tool-flash',
      modelConfig: {},
    },
    'loop-detection-double-check': {
      extends: 'base',
      modelConfig: {
        model: 'pro',
      },
    },
    'llm-edit-fixer': {
      extends: 'internal-tool-flash',
      modelConfig: {},
    },
    'next-speaker-checker': {
      extends: 'internal-tool-flash',
      modelConfig: {},
    },
    'context-snapshotter': {
      extends: 'internal-tool-flash',
      modelConfig: {
        generateContentConfig: {
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH,
          },
          temperature: 1,
          topP: 0.95,
          topK: 64,
        },
      },
    },
    // Compression aliases use tier aliases so they resolve within the family
    // of the active model (Gemini by default; e.g. deepseek when a DeepSeek
    // model is active) instead of hardcoding Gemini model names.
    'chat-compression-pro': {
      modelConfig: {
        model: 'pro',
      },
    },
    'chat-compression-flash': {
      modelConfig: {
        model: 'flash',
      },
    },
    'chat-compression-flash-lite': {
      modelConfig: {
        model: 'flash-lite',
      },
    },
    'chat-compression-default': {
      modelConfig: {
        model: 'pro',
      },
    },
    'agent-history-provider-summarizer': {
      modelConfig: {
        model: 'flash',
      },
    },

    // OpenAI-compatible providers (used with the 'openai' auth type).
    'deepseek-base': {
      extends: 'chat-base',
      modelConfig: {
        model: 'deepseek-v4-flash',
        // temperature will be ignored when thinking mode enabled
        // official default setting: thinking enabled, effort=high
      },
    },
    'deepseek-v4-flash': {
      extends: 'deepseek-base',
      modelConfig: {},
    },
    'deepseek-v4-pro': {
      extends: 'deepseek-base',
      modelConfig: {
        model: 'deepseek-v4-pro',
      },
    },
  },
  overrides: [
    {
      match: { model: 'chat-base', isRetry: true },
      modelConfig: {
        generateContentConfig: {
          temperature: 1,
        },
      },
    },
  ],
  modelDefinitions: {
    // Concrete Models
    [DEFAULT_GEMINI_FLASH_LITE_MODEL]: {
      tier: 'flash-lite',
      family: 'gemini-3',
      isVisible: true,
      contextWindow: 1_048_576,
      features: { thinking: false, multimodalToolUse: true },
    },
    [DEFAULT_GEMINI_FLASH_MODEL]: {
      tier: 'flash',
      family: 'gemini-3',
      isVisible: true,
      contextWindow: 1_048_576,
      features: { thinking: true, multimodalToolUse: true },
    },
    [DEFAULT_GEMINI_MODEL]: {
      tier: 'pro',
      family: 'gemini-3',
      isVisible: true,
      contextWindow: 1_048_576,
      features: { thinking: true, multimodalToolUse: true },
    },

    // Aliases
    auto: {
      displayName: 'Auto',
      tier: 'auto',
      isVisible: true,
      features: { thinking: true, multimodalToolUse: false },
    },
    pro: {
      tier: 'pro',
      isVisible: false,
      features: { thinking: true, multimodalToolUse: false },
    },
    flash: {
      tier: 'flash',
      isVisible: false,
      features: { thinking: true, multimodalToolUse: false },
    },
    'flash-lite': {
      tier: 'flash-lite',
      isVisible: false,
      features: { thinking: false, multimodalToolUse: false },
    },

    // OpenAI-compatible models. The tier mirrors the Gemini tier semantics so
    // that provider-aware routing can resolve tier aliases (pro/flash) within
    // the 'deepseek' family when a DeepSeek model is active.
    'deepseek-v4-flash': {
      tier: 'flash',
      family: 'deepseek',
      isVisible: true,
      contextWindow: 1000000,
      features: { thinking: true, multimodalToolUse: false },
    },
    'deepseek-v4-pro': {
      tier: 'pro',
      family: 'deepseek',
      isVisible: true,
      contextWindow: 1000000,
      features: { thinking: true, multimodalToolUse: false },
    },
  },
  modelIdResolutions: {
    auto: {
      default: DEFAULT_GEMINI_MODEL,
      contexts: [
        {
          condition: { isCustomModel: true },
          target: 'active',
        },
      ],
    },
    pro: {
      default: DEFAULT_GEMINI_MODEL,
      contexts: [
        {
          condition: { isCustomModel: true },
          target: { familyTier: 'pro' },
        },
      ],
    },
    flash: {
      default: DEFAULT_GEMINI_FLASH_MODEL,
      contexts: [
        {
          condition: { isCustomModel: true },
          target: { familyTier: 'flash' },
        },
      ],
    },
    'flash-lite': {
      default: DEFAULT_GEMINI_FLASH_LITE_MODEL,
      contexts: [
        {
          condition: { isCustomModel: true },
          target: { familyTier: 'flash-lite' },
        },
      ],
    },
  },
  classifierIdResolutions: {
    flash: {
      default: DEFAULT_GEMINI_FLASH_MODEL,
      contexts: [
        {
          condition: { isCustomModel: true },
          target: { familyTier: 'flash' },
        },
      ],
    },
    pro: {
      default: DEFAULT_GEMINI_MODEL,
      contexts: [
        {
          condition: { isCustomModel: true },
          target: { familyTier: 'pro' },
        },
      ],
    },
  },
  modelChains: {
    // Chain models use tier aliases (pro/flash/flash-lite) which resolve via
    // modelIdResolutions. With a Gemini active model they map to the default
    // Gemini models; with a custom (e.g. deepseek) active model they resolve
    // within that model's family, providing the same downgrade semantics.
    default: [
      {
        model: 'pro',
        actions: {
          terminal: 'prompt',
          transient: 'prompt',
          not_found: 'prompt',
          unknown: 'prompt',
        },
        stateTransitions: {
          terminal: 'terminal',
          transient: 'terminal',
          not_found: 'terminal',
          unknown: 'terminal',
        },
      },
      {
        model: 'flash',
        isLastResort: true,
        maxAttempts: 10,
        actions: {
          terminal: 'prompt',
          transient: 'prompt',
          not_found: 'prompt',
          unknown: 'prompt',
        },
        stateTransitions: {
          terminal: 'terminal',
          transient: 'terminal',
          not_found: 'terminal',
          unknown: 'terminal',
        },
      },
    ],
    'auto-default': [
      {
        model: 'pro',
        maxAttempts: 3,
        actions: {
          terminal: 'prompt',
          transient: 'silent',
          not_found: 'prompt',
          unknown: 'prompt',
        },
        stateTransitions: {
          terminal: 'terminal',
          transient: 'sticky_retry',
          not_found: 'terminal',
          unknown: 'terminal',
        },
      },
      {
        model: 'flash',
        isLastResort: true,
        maxAttempts: 10,
        actions: {
          terminal: 'prompt',
          transient: 'prompt',
          not_found: 'prompt',
          unknown: 'prompt',
        },
        stateTransitions: {
          terminal: 'terminal',
          transient: 'terminal',
          not_found: 'terminal',
          unknown: 'terminal',
        },
      },
    ],
    lite: [
      {
        model: 'flash-lite',
        actions: {
          terminal: 'silent',
          transient: 'silent',
          not_found: 'silent',
          unknown: 'silent',
        },
        stateTransitions: {
          terminal: 'terminal',
          transient: 'terminal',
          not_found: 'terminal',
          unknown: 'terminal',
        },
      },
      {
        model: 'flash',
        actions: {
          terminal: 'silent',
          transient: 'silent',
          not_found: 'silent',
          unknown: 'silent',
        },
        stateTransitions: {
          terminal: 'terminal',
          transient: 'terminal',
          not_found: 'terminal',
          unknown: 'terminal',
        },
      },
      {
        model: 'pro',
        isLastResort: true,
        actions: {
          terminal: 'silent',
          transient: 'silent',
          not_found: 'silent',
          unknown: 'silent',
        },
        stateTransitions: {
          terminal: 'terminal',
          transient: 'terminal',
          not_found: 'terminal',
          unknown: 'terminal',
        },
      },
    ],
  },
};
