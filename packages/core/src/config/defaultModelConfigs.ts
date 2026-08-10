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
          },
          temperature: 1,
          topP: 0.95,
          topK: 64,
        },
      },
    },
    'chat-base-3': {
      extends: 'chat-base',
      modelConfig: {
        generateContentConfig: {
          thinkingConfig: {
            thinkingLevel: ThinkingLevel.HIGH,
          },
        },
      },
    },
    // Because `gemini-2.5-pro` and related model configs are "user-facing"
    // today, i.e. they could be passed via `--model`, we have to be careful to
    // ensure these model configs can be used interactively.
    // TODO(joshualitt): Introduce internal base configs for the various models,
    // note: we will have to think carefully about names.
    [DEFAULT_GEMINI_MODEL]: {
      extends: 'chat-base-3',
      modelConfig: {
        model: DEFAULT_GEMINI_MODEL,
      },
    },
    [DEFAULT_GEMINI_FLASH_LITE_MODEL]: {
      extends: 'chat-base-3',
      modelConfig: {
        model: DEFAULT_GEMINI_FLASH_LITE_MODEL,
      },
    },
    [DEFAULT_GEMINI_FLASH_MODEL]: {
      extends: 'chat-base-3',
      modelConfig: {
        model: DEFAULT_GEMINI_FLASH_MODEL,
      },
    },

    // Bases for the internal model configs.
    'gemini-3-flash-base': {
      extends: 'base',
      modelConfig: {
        model: 'gemini-3.5-flash',
      },
    },
    classifier: {
      extends: 'base',
      modelConfig: {
        model: 'flash-lite',
        generateContentConfig: {
          maxOutputTokens: 1024,
          thinkingConfig: {
            thinkingBudget: 512,
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
            thinkingBudget: 0,
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
            thinkingBudget: 0,
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
            thinkingBudget: 0,
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
      extends: 'gemini-3-flash-base',
      modelConfig: {
        generateContentConfig: {
          tools: [{ googleSearch: {} }],
        },
      },
    },
    'web-fetch': {
      extends: 'gemini-3-flash-base',
      modelConfig: {
        generateContentConfig: {
          tools: [{ urlContext: {} }],
        },
      },
    },
    // TODO(joshualitt): During cleanup, make modelConfig optional.
    'web-fetch-fallback': {
      extends: 'gemini-3-flash-base',
      modelConfig: {},
    },
    'loop-detection': {
      extends: 'gemini-3-flash-base',
      modelConfig: {},
    },
    'loop-detection-double-check': {
      extends: 'base',
      modelConfig: {
        model: DEFAULT_GEMINI_MODEL,
      },
    },
    'llm-edit-fixer': {
      extends: 'gemini-3-flash-base',
      modelConfig: {},
    },
    'next-speaker-checker': {
      extends: 'gemini-3-flash-base',
      modelConfig: {},
    },
    'context-snapshotter': {
      extends: 'gemini-3-flash-base',
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
    'chat-compression-pro': {
      modelConfig: {
        model: DEFAULT_GEMINI_MODEL,
      },
    },
    'chat-compression-flash': {
      modelConfig: {
        model: DEFAULT_GEMINI_FLASH_MODEL,
      },
    },
    'chat-compression-flash-lite': {
      modelConfig: {
        model: DEFAULT_GEMINI_FLASH_LITE_MODEL,
      },
    },
    'chat-compression-default': {
      modelConfig: {
        model: DEFAULT_GEMINI_MODEL,
      },
    },
    'agent-history-provider-summarizer': {
      modelConfig: {
        model: DEFAULT_GEMINI_FLASH_MODEL,
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
      features: { thinking: false, multimodalToolUse: true },
    },
    [DEFAULT_GEMINI_FLASH_MODEL]: {
      tier: 'flash',
      family: 'gemini-3',
      isVisible: true,
      features: { thinking: true, multimodalToolUse: true },
    },
    [DEFAULT_GEMINI_MODEL]: {
      tier: 'pro',
      family: 'gemini-3',
      isVisible: true,
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
  },
  modelIdResolutions: {
    auto: {
      default: DEFAULT_GEMINI_MODEL,
    },
    pro: {
      default: DEFAULT_GEMINI_MODEL,
    },
    flash: {
      default: DEFAULT_GEMINI_FLASH_MODEL,
    },
    'flash-lite': {
      default: DEFAULT_GEMINI_FLASH_LITE_MODEL,
    },
  },
  classifierIdResolutions: {
    flash: {
      default: DEFAULT_GEMINI_FLASH_MODEL,
    },
    pro: {
      default: DEFAULT_GEMINI_MODEL,
    },
  },
  modelChains: {
    default: [
      {
        model: DEFAULT_GEMINI_MODEL,
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
        model: DEFAULT_GEMINI_FLASH_MODEL,
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
        model: DEFAULT_GEMINI_MODEL,
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
        model: DEFAULT_GEMINI_FLASH_MODEL,
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
        model: DEFAULT_GEMINI_FLASH_MODEL,
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
        model: DEFAULT_GEMINI_MODEL,
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
