/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ModelResolutionContext {
  useCustomTools?: boolean;
  requestedModel?: string;
  releaseChannel?: string;
}

/**
 * Interface for the ModelConfigService to break circular dependencies.
 */
export interface IModelConfigService {
  getModelDefinition(modelId: string):
    | {
        tier?: string;
        family?: string;
        isPreview?: boolean;
        displayName?: string;
        features?: {
          thinking?: boolean;
          multimodalToolUse?: boolean;
        };
      }
    | undefined;

  resolveModelId(
    requestedModel: string,
    context?: ModelResolutionContext,
  ): string;

  resolveClassifierModelId(
    tier: string,
    requestedModel: string,
    context?: ModelResolutionContext,
  ): string;
}

/**
 * Interface defining the minimal configuration required for model capability checks.
 * This helps break circular dependencies between Config and models.ts.
 */
export interface ModelCapabilityContext {
  readonly modelConfigService: IModelConfigService;
  getExperimentalDynamicModelConfiguration(): boolean;
}

export const DEFAULT_GEMINI_MODEL = 'gemini-pro-latest';
export const DEFAULT_GEMINI_FLASH_MODEL = 'gemini-flash-latest';
export const DEFAULT_GEMINI_FLASH_LITE_MODEL = 'gemini-flash-lite-latest';

// Model aliases for user convenience.
export const GEMINI_MODEL_ALIAS_AUTO = 'auto';
export const GEMINI_MODEL_ALIAS_PRO = 'pro';
export const GEMINI_MODEL_ALIAS_FLASH = 'flash';
export const GEMINI_MODEL_ALIAS_FLASH_LITE = 'flash-lite';

export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

// Cap the thinking at 8192 to prevent run-away thinking loops.
export const DEFAULT_THINKING_MODE = 8192;

export function getAutoModelDescription() {
  return `Let Sparkle CLI decide the best model for the task: ${getDisplayString(DEFAULT_GEMINI_MODEL)}, ${getDisplayString(DEFAULT_GEMINI_FLASH_MODEL)}`;
}

/**
 * Resolves the requested model alias (e.g., 'auto', 'pro', 'flash', 'flash-lite')
 * to a concrete model name.
 *
 * @param requestedModel The model alias or concrete model name requested by the user.
 * @param config Optional config object for dynamic model configuration.
 * @returns The resolved concrete model name.
 */
export function resolveModel(
  requestedModel: string,
  config?: ModelCapabilityContext,
): string {
  // Defensive check against non-string inputs at runtime
  const normalizedModel = Array.isArray(requestedModel)
    ? String(requestedModel.at(-1) ?? '').trim() || ''
    : typeof requestedModel !== 'string'
      ? String(requestedModel ?? '').trim() || ''
      : requestedModel.trim() || '';

  if (config?.getExperimentalDynamicModelConfiguration?.() === true) {
    return config.modelConfigService.resolveModelId(normalizedModel, {
      useCustomTools: false,
    });
  }

  let resolved: string;
  switch (normalizedModel) {
    case GEMINI_MODEL_ALIAS_AUTO:
    case GEMINI_MODEL_ALIAS_PRO: {
      resolved = DEFAULT_GEMINI_MODEL;
      break;
    }
    case GEMINI_MODEL_ALIAS_FLASH: {
      resolved = DEFAULT_GEMINI_FLASH_MODEL;
      break;
    }
    case GEMINI_MODEL_ALIAS_FLASH_LITE: {
      resolved = DEFAULT_GEMINI_FLASH_LITE_MODEL;
      break;
    }
    default: {
      resolved = normalizedModel;
      break;
    }
  }

  if (resolved === 'none') {
    return DEFAULT_GEMINI_FLASH_LITE_MODEL;
  }

  if (isFlashModel(resolved) && normalizedModel !== 'gemini-3-flash-preview') {
    return DEFAULT_GEMINI_FLASH_MODEL;
  }

  return resolved;
}

function isFlashModel(model: string): boolean {
  return (
    model === DEFAULT_GEMINI_FLASH_MODEL ||
    model === 'flash' ||
    model.endsWith('flash')
  );
}

/**
 * Resolves the appropriate model based on the classifier's decision.
 *
 * @param requestedModel The current requested model (e.g. auto).
 * @param modelAlias The alias selected by the classifier ('flash' or 'pro').
 * @param config Optional config object for dynamic model configuration.
 * @returns The resolved concrete model name.
 */
export function resolveClassifierModel(
  requestedModel: string,
  modelAlias: string,
  config?: ModelCapabilityContext,
): string {
  if (config?.getExperimentalDynamicModelConfiguration?.() === true) {
    return config.modelConfigService.resolveClassifierModelId(
      modelAlias,
      requestedModel,
    );
  }

  if (modelAlias === GEMINI_MODEL_ALIAS_FLASH) {
    return resolveModel(GEMINI_MODEL_ALIAS_FLASH, config);
  }
  return resolveModel(requestedModel, config);
}

export function getDisplayString(
  model: string,
  config?: ModelCapabilityContext,
) {
  if (config?.getExperimentalDynamicModelConfiguration?.() === true) {
    const definition = config.modelConfigService.getModelDefinition(model);
    if (definition?.displayName) {
      return definition.displayName;
    }
  }

  switch (model) {
    case GEMINI_MODEL_ALIAS_AUTO:
      return 'Auto';
    case GEMINI_MODEL_ALIAS_PRO:
      return DEFAULT_GEMINI_MODEL;
    case GEMINI_MODEL_ALIAS_FLASH:
      return DEFAULT_GEMINI_FLASH_MODEL;
    default:
      return model;
  }
}

/**
 * Checks if the model is a Pro model.
 *
 * @param model The model name to check.
 * @param config Optional config object for dynamic model configuration.
 * @returns True if the model is a Pro model.
 */
export function isProModel(
  model: string,
  config?: ModelCapabilityContext,
): boolean {
  if (config?.getExperimentalDynamicModelConfiguration?.() === true) {
    return config.modelConfigService.getModelDefinition(model)?.tier === 'pro';
  }
  return model.toLowerCase().includes('pro');
}

/**
 * Checks if the model is a "custom" model (not Gemini branded).
 *
 * @param model The model name to check.
 * @param config Optional config object for dynamic model configuration.
 * @returns True if the model is not a Gemini branded model.
 */
export function isCustomModel(
  model: string,
  config?: ModelCapabilityContext,
): boolean {
  if (config?.getExperimentalDynamicModelConfiguration?.() === true) {
    const resolved = resolveModel(model, config);
    return (
      config.modelConfigService.getModelDefinition(resolved)?.tier ===
        'custom' || !resolved.startsWith('gemini-')
    );
  }
  const resolved = resolveModel(model);
  return !resolved.startsWith('gemini-');
}

/**
 * Checks if the model should be treated as a modern model.
 * All Gemini models are treated as Gemini 3, and custom models are also
 * treated as modern.
 *
 * @param model The model name to check.
 * @returns True if the model supports modern features like thoughts.
 */
export function supportsModernFeatures(_model: string): boolean {
  return true;
}

/**
 * Checks if the model is an auto model.
 *
 * @param model The model name to check.
 * @param config Optional config object for dynamic model configuration.
 * @returns True if the model is an auto model.
 */
export function isAutoModel(
  model: string,
  config?: ModelCapabilityContext,
): boolean {
  if (config?.getExperimentalDynamicModelConfiguration?.() === true) {
    return config.modelConfigService.getModelDefinition(model)?.tier === 'auto';
  }
  return model === GEMINI_MODEL_ALIAS_AUTO;
}

/**
 * Checks if the model supports multimodal function responses (multimodal data nested within function response).
 * This is supported in Gemini 3.
 *
 * @param model The model name to check.
 * @returns True if the model supports multimodal function responses.
 */
export function supportsMultimodalFunctionResponse(
  model: string,
  config?: ModelCapabilityContext,
): boolean {
  if (config?.getExperimentalDynamicModelConfiguration?.() === true) {
    return (
      config.modelConfigService.getModelDefinition(model)?.features
        ?.multimodalToolUse === true
    );
  }
  return model.startsWith('gemini-');
}
