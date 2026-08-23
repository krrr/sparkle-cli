/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ModelResolutionContext {
  requestedModel?: string;
}

/**
 * Interface for the ModelConfigService to break circular dependencies.
 */
export interface IModelConfigService {
  getModelDefinition(modelId: string):
    | {
        tier?: string;
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
}

export const DEFAULT_GEMINI_MODEL = 'gemini-pro-latest';
export const DEFAULT_GEMINI_FLASH_MODEL = 'gemini-flash-latest';
export const DEFAULT_GEMINI_FLASH_LITE_MODEL = 'gemini-flash-lite-latest';

export const DEFAULT_OPENAI_MODEL = 'gpt-4o';

// Model aliases for user convenience.
export const SPARKLE_MODEL_ALIAS_AUTO = 'auto';
export const SPARKLE_MODEL_ALIAS_PRO = 'pro';
export const SPARKLE_MODEL_ALIAS_FLASH = 'flash';
export const SPARKLE_MODEL_ALIAS_FLASH_LITE = 'flash-lite';

export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

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

  if (config) {
    return config.modelConfigService.resolveModelId(normalizedModel);
  }

  // Static fallback matching the default dynamic resolution for standard aliases.
  switch (normalizedModel) {
    case SPARKLE_MODEL_ALIAS_AUTO:
    case SPARKLE_MODEL_ALIAS_PRO: {
      return DEFAULT_GEMINI_MODEL;
    }
    case SPARKLE_MODEL_ALIAS_FLASH: {
      return DEFAULT_GEMINI_FLASH_MODEL;
    }
    case SPARKLE_MODEL_ALIAS_FLASH_LITE: {
      return DEFAULT_GEMINI_FLASH_LITE_MODEL;
    }
    default: {
      return normalizedModel;
    }
  }
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
  if (config) {
    return config.modelConfigService.resolveClassifierModelId(
      modelAlias,
      requestedModel,
    );
  }

  if (modelAlias === SPARKLE_MODEL_ALIAS_FLASH) {
    return resolveModel(SPARKLE_MODEL_ALIAS_FLASH, config);
  }
  return resolveModel(requestedModel, config);
}

export function getDisplayString(
  model: string,
  config?: ModelCapabilityContext,
) {
  if (config) {
    const definition = config.modelConfigService.getModelDefinition(model);
    if (definition?.displayName) {
      return definition.displayName;
    }
  }

  switch (model) {
    case SPARKLE_MODEL_ALIAS_AUTO:
      return 'Auto';
    case SPARKLE_MODEL_ALIAS_PRO:
      return DEFAULT_GEMINI_MODEL;
    case SPARKLE_MODEL_ALIAS_FLASH:
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
  if (config) {
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
  if (config) {
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
  if (config) {
    return config.modelConfigService.getModelDefinition(model)?.tier === 'auto';
  }
  return model === SPARKLE_MODEL_ALIAS_AUTO;
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
  if (config) {
    return (
      config.modelConfigService.getModelDefinition(model)?.features
        ?.multimodalToolUse === true
    );
  }
  return model.startsWith('gemini-');
}
