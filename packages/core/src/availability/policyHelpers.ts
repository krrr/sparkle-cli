/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateContentConfig } from '@google/genai';
import type { Config } from '../config/config.js';
import type {
  FailureKind,
  FallbackAction,
  ModelPolicy,
  ModelPolicyChain,
  RetryAvailabilityContext,
} from './modelPolicy.js';
import {
  createDefaultPolicy,
  createSingleModelChain,
  SILENT_ACTIONS,
} from './policyCatalog.js';
import {
  DEFAULT_GEMINI_FLASH_LITE_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
  DEFAULT_GEMINI_MODEL,
  isAutoModel,
  isCustomModel,
  resolveModel,
} from '../config/models.js';
import { normalizeModelId } from '../utils/modelUtils.js';
import type { ModelSelectionResult } from './modelAvailabilityService.js';
import {
  ModelConfigService,
  type ModelConfigKey,
  type ResolutionContext,
} from '../services/modelConfigService.js';
import { ApprovalMode } from '../policy/types.js';

/**
 * Resolves the active policy chain for the given config, ensuring the
 * user-selected active model is represented.
 */
const TIER_ALIASES = new Set(['pro', 'flash', 'flash-lite', 'auto']);

/**
 * True if the model string is a generic tier alias (pro/flash/flash-lite/auto)
 * that carries no family information.
 */
function isTierAlias(model: string): boolean {
  return TIER_ALIASES.has(model);
}

export function resolvePolicyChain(
  config: Config,
  preferredModel?: string,
): ModelPolicyChain {
  const normalizedPreferredModel = preferredModel
    ? normalizeModelId(preferredModel)
    : undefined;
  const activeModel = normalizeModelId(
    config.getActiveModel?.() ?? config.getModel(),
  );
  // Tier aliases carry no family information. When a preferred model is such
  // an alias (e.g. a tool request resolved to 'pro' through a model config
  // alias), anchor resolution on the active model so the tier maps within the
  // active model's family instead of always resolving to Gemini models.
  const anchorModel =
    normalizedPreferredModel && isTierAlias(normalizedPreferredModel)
      ? activeModel
      : (normalizedPreferredModel ?? activeModel);
  const modelFromConfig = anchorModel;
  const configuredModel = normalizeModelId(config.getModel());

  let chain: ModelPolicyChain | undefined;

  // Capture the original family intent before any normalization or early downgrade.
  // All Gemini models are treated as Gemini 3.
  const isOriginallyGemini3 = !isCustomModel(modelFromConfig, config);

  const resolvedModel = normalizeModelId(resolveModel(modelFromConfig, config));
  const isAutoPreferred = normalizedPreferredModel
    ? isAutoModel(normalizedPreferredModel, config)
    : false;
  const isAutoConfigured = isAutoModel(configuredModel, config);

  // Pass the requested model through as the resolution anchor so tier aliases
  // (pro/flash/flash-lite) inside chains resolve within the family of the
  // active model (e.g. deepseek models) instead of always mapping to Gemini.
  const resolutionContext: ResolutionContext = {
    requestedModel: modelFromConfig,
  };

  const tier =
    config.modelConfigService.getModelDefinition(resolvedModel)?.tier;

  if (
    resolvedModel === DEFAULT_GEMINI_FLASH_LITE_MODEL ||
    tier === 'flash-lite'
  ) {
    chain = config.modelConfigService.resolveChain('lite', resolutionContext);
  } else if (
    isOriginallyGemini3 ||
    isAutoPreferred ||
    isAutoConfigured ||
    resolvedModel === DEFAULT_GEMINI_FLASH_MODEL ||
    tier === 'pro' ||
    tier === 'flash'
  ) {
    // 1. Try to find a chain specifically for the current configured alias
    if (
      isAutoConfigured &&
      config.modelConfigService.getModelChain(configuredModel)
    ) {
      chain = config.modelConfigService.resolveChain(
        configuredModel,
        resolutionContext,
      );
    }
    // 2. Fallback to family-based auto-routing
    if (!chain) {
      const isAutoSelection = isAutoPreferred || isAutoConfigured;
      const autoPrefix = isAutoSelection ? 'auto-' : '';
      chain = config.modelConfigService.resolveChain(
        `${autoPrefix}default`,
        resolutionContext,
      );
    }
  }
  if (!chain) {
    // No matching modelChains found, default to single model chain
    chain = createSingleModelChain(modelFromConfig);
  }
  chain = applyDynamicSlicing(chain, resolvedModel);

  // Apply Unified Silent Injection for Plan Mode with defensive checks
  if (config?.getApprovalMode?.() === ApprovalMode.PLAN) {
    return chain.map((policy) => ({
      ...policy,
      actions: { ...SILENT_ACTIONS },
    }));
  }

  return chain;
}

/**
 * Applies active-index slicing to a chain template.
 */
function applyDynamicSlicing(
  chain: ModelPolicy[],
  resolvedModel: string,
): ModelPolicyChain {
  const normalizedResolved = normalizeModelId(resolvedModel);
  const activeIndex = chain.findIndex(
    (policy) => normalizeModelId(policy.model) === normalizedResolved,
  );
  if (activeIndex !== -1) {
    return [...chain.slice(activeIndex)];
  }

  // If the user specified a model not in the default chain, we assume they want
  // *only* that model. We do not fallback to the default chain.
  return [createDefaultPolicy(resolvedModel, { isLastResort: true })];
}

/**
 * Produces the failed policy (if it exists in the chain) and the list of
 * fallback candidates that follow it.
 * @param chain - The ordered list of available model policies.
 * @param failedModel - The identifier of the model that failed.
 */
export function buildFallbackPolicyContext(
  chain: ModelPolicyChain,
  failedModel: string,
): {
  failedPolicy?: ModelPolicy;
  candidates: ModelPolicy[];
} {
  const normalizedFailed = normalizeModelId(failedModel);
  const index = chain.findIndex(
    (policy) => normalizeModelId(policy.model) === normalizedFailed,
  );
  if (index === -1) {
    return { failedPolicy: undefined, candidates: chain };
  }
  // Return the remaining candidates after the failed model to prioritize
  // downgrades (continuing the chain).
  return {
    failedPolicy: chain[index],
    candidates: [...chain.slice(index + 1)],
  };
}

export function resolvePolicyAction(
  failureKind: FailureKind,
  policy: ModelPolicy,
): FallbackAction {
  return policy.actions?.[failureKind] ?? 'prompt';
}

/**
 * Creates a context provider for retry logic that returns the availability
 * sevice and resolves the current model's policy.
 *
 * @param modelGetter A function that returns the model ID currently being attempted.
 *        (Allows handling dynamic model changes during retries).
 */
export function createAvailabilityContextProvider(
  config: Config,
  modelGetter: () => string,
): () => RetryAvailabilityContext | undefined {
  return () => {
    const service = config.getModelAvailabilityService();
    const currentModel = modelGetter();

    // Resolve the chain for the specific model we are attempting.
    const chain = resolvePolicyChain(config, currentModel);
    const policy = chain.find((p) => p.model === currentModel);

    return policy ? { service, policy } : undefined;
  };
}

/**
 * Selects the model to use for an attempt via the availability service and
 * returns the selection context.
 */
export function selectModelForAvailability(
  config: Config,
  requestedModel: string,
): ModelSelectionResult {
  const chain = resolvePolicyChain(config, requestedModel);
  const selection = config
    .getModelAvailabilityService()
    .selectFirstAvailable(chain.map((p) => p.model));

  if (selection.selectedModel) return selection;

  const backupModel =
    chain.find((p) => p.isLastResort)?.model ?? DEFAULT_GEMINI_MODEL;

  return { selectedModel: backupModel, skipped: [] };
}

/**
 * Applies the model availability selection logic, including side effects
 * (setting active model, consuming sticky attempts) and config updates.
 */
export function applyModelSelection(
  config: Config,
  modelConfigKey: ModelConfigKey,
  options: { consumeAttempt?: boolean } = {},
): { model: string; config: GenerateContentConfig; maxAttempts?: number } {
  const resolved = config.modelConfigService.getResolvedConfig(modelConfigKey);
  const model = resolved.model;
  const selection = selectModelForAvailability(config, model);

  if (!selection) {
    return { model, config: resolved.generateContentConfig };
  }

  const finalModel = selection.selectedModel ?? model;
  let generateContentConfig = resolved.generateContentConfig;

  if (finalModel !== model) {
    const fallbackResolved = config.modelConfigService.getResolvedConfig({
      ...modelConfigKey,
      model: finalModel,
    });
    // The re-resolve is keyed by the fallback model id, which drops the
    // role-scoped config attached to the original alias (e.g. the
    // classifier's maxOutputTokens). Merge with the role config winning so
    // the fallback model's config only fills in unset fields.
    generateContentConfig = ModelConfigService.deepMerge(
      fallbackResolved.generateContentConfig,
      resolved.generateContentConfig,
    );
  }

  if (modelConfigKey.isChatModel) {
    config.setActiveModel(finalModel);
  }

  if (selection.attempts && options.consumeAttempt !== false) {
    config.getModelAvailabilityService().consumeStickyAttempt(finalModel);
  }

  const chain = resolvePolicyChain(config, finalModel);
  const policy = chain.find((p) => p.model === finalModel);

  return {
    model: finalModel,
    config: generateContentConfig,
    maxAttempts: selection.attempts ?? policy?.maxAttempts,
  };
}

export function applyAvailabilityTransition(
  getContext: (() => RetryAvailabilityContext | undefined) | undefined,
  failureKind: FailureKind,
): void {
  const context = getContext?.();
  if (!context) return;

  const transition = context.policy.stateTransitions?.[failureKind];
  if (!transition) return;

  if (transition === 'terminal') {
    context.service.markTerminal(
      context.policy.model,
      failureKind === 'terminal' ? 'quota' : 'capacity',
    );
  } else if (transition === 'sticky_retry') {
    context.service.markRetryOncePerTurn(
      context.policy.model,
      context.policy.maxAttempts,
    );
    context.service.consumeStickyAttempt(context.policy.model);
  }
}
