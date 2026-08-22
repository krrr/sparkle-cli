/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateContentConfig } from '@google/genai';
import type { ModelPolicy } from '../availability/modelPolicy.js';
import {
  getDisplayString,
  getAutoModelDescription,
  SPARKLE_MODEL_ALIAS_AUTO,
  SPARKLE_MODEL_ALIAS_PRO,
  SPARKLE_MODEL_ALIAS_FLASH,
  SPARKLE_MODEL_ALIAS_FLASH_LITE,
  DEFAULT_OPENAI_MODEL,
} from '../config/models.js';
import { ProviderType } from '../config/constants.js';
import type {
  ProviderModel,
  ProviderProfile,
} from '../config/providerProfile.js';

// The primary key for the ModelConfig is the model string. However, we also
// support a secondary key to limit the override scope, typically an agent name.
export interface ModelConfigKey {
  model: string;

  // In many cases the model (or model config alias) is sufficient to fully
  // scope an override. However, in some cases, we want additional scoping of
  // an override. Consider the case of developing a new subagent, perhaps we
  // want to override the temperature for all model calls made by this subagent.
  // However, we most certainly do not want to change the temperature for other
  // subagents, nor do we want to introduce a whole new set of aliases just for
  // the new subagent. Using the `overrideScope` we can limit our overrides to
  // model calls made by this specific subagent, and no others, while still
  // ensuring model configs are fully orthogonal to the agents who use them.
  overrideScope?: string;

  // Indicates whether this configuration request is happening during a retry attempt.
  // This allows overrides to specify different settings (e.g., higher temperature)
  // specifically for retry scenarios.
  isRetry?: boolean;

  // Indicates whether this request originates from the primary interactive chat model.
  // Enables the default fallback configuration to `chat-base` when unknown.
  isChatModel?: boolean;

  // The last stream error that triggered this retry attempt, if any.
  lastStreamError?: unknown;
}

/**
 * The SDK's `GenerateContentConfig` extended with Sparkle-owned fields that
 * ride along the config pipeline and are consumed only by the
 * OpenAI-compatible adapter. The native Gemini path ignores (and may reject)
 * these fields, so they must only be set for custom providers.
 */
export interface SparkleGenerateContentConfig extends GenerateContentConfig {
  /**
   * Request-body passthrough for OpenAI-compatible providers. Keys use the
   * wire format (snake_case); `reasoning_effort` is lifted to the top-level
   * request parameter by the adapter's config converter.
   */
  openaiExtraBody?: Record<string, unknown>;
}

export interface ModelConfig {
  model?: string;
  generateContentConfig?: SparkleGenerateContentConfig;
}

export interface ModelConfigOverride {
  match: {
    model?: string; // Can be a model name or an alias
    overrideScope?: string;
    isRetry?: boolean;
  };
  modelConfig: ModelConfig;
}

export interface ModelConfigAlias {
  extends?: string;
  modelConfig: ModelConfig;
}

// A model definition is a mapping from a model name to a list of features
// that the model supports. Model names can be either direct model IDs
// (gemini-pro-latest) or aliases (auto).
export interface ModelDefinition {
  displayName?: string;
  tier?: string; // 'pro' | 'flash' | 'flash-lite' | 'custom' | 'auto'
  // Specifies whether the model should be visible in the dialog.
  isVisible?: boolean;
  /** A short description of the model for the dialog. */
  dialogDescription?: string;
  contextWindow?: number;
  features?: {
    // Whether the model supports thinking.
    thinking?: boolean;
    // Whether the model supports mutlimodal function responses. This is
    // supported in Gemini 3.
    multimodalToolUse?: boolean;
    toolUse?: boolean;
  };
}

// A model resolution is a mapping from a model name to a list of conditions
// that can be used to resolve the model to a model ID.
export interface ModelResolution {
  // The default model ID to use when no conditions are met.
  default: string;
  // A list of conditions that can be used to resolve the model.
  contexts?: Array<{
    // The condition to check for.
    condition: ResolutionCondition;
    // The model ID to use when the condition is met.
    target: ModelResolutionTarget;
  }>;
}

export type ModelResolutionTarget = string;

/** The actual state of the current session. */
export interface ResolutionContext {
  useCustomTools?: boolean;
  requestedModel?: string;
}

/** The requirements defined in the registry. */
export interface ResolutionCondition {
  useCustomTools?: boolean;
  /** Matches if the current model is in this list. */
  requestedModels?: string[];
}

export interface ModelConfigServiceConfig {
  aliases?: Record<string, ModelConfigAlias>;
  customAliases?: Record<string, ModelConfigAlias>;
  overrides?: ModelConfigOverride[];
  customOverrides?: ModelConfigOverride[];
  modelDefinitions?: Record<string, ModelDefinition>;
  modelIdResolutions?: Record<string, ModelResolution>;
  classifierIdResolutions?: Record<string, ModelResolution>;
  modelChains?: Record<string, ModelPolicy[]>;
}

/**
 * Fallback context window (in tokens), matching the 1M-token Gemini models.
 * Used when a model definition does not declare a `contextWindow`.
 */
export const DEFAULT_CONTEXT_WINDOW = 1_048_576;

const MAX_ALIAS_CHAIN_DEPTH = 100;

/**
 * Tier/alias names can be stored in `profile.defaultModel` (e.g. when the
 * user remembers "Auto" as the default). They are resolution keys, never
 * concrete model IDs, so they must not become resolution targets themselves;
 * doing so would make resolutions self-referential.
 */
const RESERVED_MODEL_ALIASES: ReadonlySet<string> = new Set([
  SPARKLE_MODEL_ALIAS_AUTO,
  SPARKLE_MODEL_ALIAS_PRO,
  SPARKLE_MODEL_ALIAS_FLASH,
  SPARKLE_MODEL_ALIAS_FLASH_LITE,
]);

export type ResolvedModelConfig = _ResolvedModelConfig & {
  readonly _brand: unique symbol;
};

export interface _ResolvedModelConfig {
  model: string; // The actual, resolved model name
  generateContentConfig: SparkleGenerateContentConfig;
}

/**
 * Maps a profile model's `generateConfig` onto the config pipeline's
 * shape. `reasoningEffort` travels via `openaiExtraBody` — the adapter's
 * config converter lifts it to the top-level `reasoning_effort` request
 * parameter. Returns undefined when there is nothing to apply.
 */
function providerModelToGenerateContentConfig(
  generateConfig: ProviderModel['generateConfig'],
): SparkleGenerateContentConfig | undefined {
  if (!generateConfig) {
    return undefined;
  }
  const config: SparkleGenerateContentConfig = {};
  if (generateConfig.temperature !== undefined) {
    config.temperature = generateConfig.temperature;
  }
  if (generateConfig.topP !== undefined) {
    config.topP = generateConfig.topP;
  }
  if (generateConfig.reasoningEffort) {
    config.openaiExtraBody = {
      reasoning_effort: generateConfig.reasoningEffort,
    };
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

export class ModelConfigService {
  private readonly baseConfig: ModelConfigServiceConfig;
  private currentConfig: ModelConfigServiceConfig;
  private isCustomProvider: boolean = false;
  private readonly runtimeAliases: Record<string, ModelConfigAlias> = {};
  private readonly runtimeOverrides: ModelConfigOverride[] = [];

  constructor(config: ModelConfigServiceConfig) {
    this.baseConfig = config;
    this.currentConfig = config;
  }

  /**
   * Recompiles currentConfig when active profile switches or its models change.
   */
  applyProfile(profile?: ProviderProfile): void {
    if (!profile || profile.providerType === ProviderType.USE_GEMINI) {
      this.currentConfig = this.baseConfig;
      this.isCustomProvider = false;
      return;
    }

    this.isCustomProvider = true;
    const models = profile.models ?? [];

    // 1. Calculate Tier targets
    const proModel = models.find((m) => m.tier === 'pro');
    const flashModel = models.find((m) => m.tier === 'flash');
    const liteModel = models.find((m) => m.tier === 'flash-lite');

    // An alias name stored as defaultModel resolves through these very
    // entries, so it can never serve as a concrete target.
    const defaultTarget =
      profile.defaultModel && !RESERVED_MODEL_ALIASES.has(profile.defaultModel)
        ? profile.defaultModel
        : undefined;
    const proTarget =
      proModel?.id || defaultTarget || models[0]?.id || DEFAULT_OPENAI_MODEL;
    const flashTarget = flashModel?.id || proTarget;
    const liteTarget = liteModel?.id || flashTarget;
    const autoTarget = defaultTarget || flashTarget;

    // 2. Convert profile models to ModelDefinition
    const dynamicDefinitions: Record<string, ModelDefinition> = {};
    for (const m of models) {
      dynamicDefinitions[m.id] = {
        tier: m.tier ?? 'custom',
        isVisible: true,
        displayName: m.id,
        contextWindow: m.contextWindow,
        features: m.features ?? { thinking: true, multimodalToolUse: false },
      };
    }

    // 3. Convert per-model generate configs into model-matched overrides so
    // sampling parameters (reasoningEffort, temperature, topP) reach every
    // request keyed by the model id. Injected into the product `overrides`
    // array, ahead of the user's `customOverrides`, so user-written overrides
    // always win ties against profile settings.
    const dynamicOverrides: ModelConfigOverride[] = [];
    for (const m of models) {
      const generateContentConfig = providerModelToGenerateContentConfig(
        m.generateConfig,
      );
      if (generateContentConfig) {
        dynamicOverrides.push({
          match: { model: m.id },
          modelConfig: { generateContentConfig },
        });
      }
    }

    // 4. Build merged currentConfig
    this.currentConfig = {
      ...this.baseConfig,
      modelDefinitions: {
        ...this.baseConfig.modelDefinitions,
        ...dynamicDefinitions,
      },
      overrides: [...(this.baseConfig.overrides ?? []), ...dynamicOverrides],
      modelIdResolutions: {
        ...this.baseConfig.modelIdResolutions,
        pro: { default: proTarget },
        flash: { default: flashTarget },
        'flash-lite': { default: liteTarget },
        auto: { default: autoTarget },
      },
      classifierIdResolutions: {
        ...this.baseConfig.classifierIdResolutions,
        flash: { default: flashTarget },
        pro: { default: proTarget },
      },
    };
  }

  /**
   * Returns a standardized list of available model options based on the resolution context.
   * This logic is shared across the TUI and ACP mode.
   */
  getAvailableModelOptions(context: ResolutionContext): Array<{
    modelId: string;
    name: string;
    description: string;
    tier: string;
  }> {
    const definitions = this.currentConfig.modelDefinitions ?? {};

    const mainOptions = Object.entries(definitions)
      .filter(([_, m]) => {
        if (m.isVisible !== true) return false;
        if (m.tier !== 'auto') return false;
        return true;
      })
      .map(([id, m]) => {
        const description =
          id === 'auto'
            ? getAutoModelDescription()
            : (m.dialogDescription ?? '');

        return {
          modelId: id,
          name: m.displayName ?? getDisplayString(id),
          description,
          tier: m.tier ?? 'auto',
        };
      });

    const manualOptions = Object.entries(definitions)
      .filter(([_, m]) => {
        if (m.isVisible !== true) return false;
        if (m.tier === 'auto') return false;
        return true;
      })
      .map(([id, m]) => {
        const resolvedId = this.resolveModelId(id, context);
        const titleId = this.resolveModelId(id);
        return {
          modelId: resolvedId,
          name: m.displayName ?? getDisplayString(titleId),
          description: m.dialogDescription ?? '',
          tier: m.tier ?? 'custom',
        };
      });

    // Deduplicate manual options
    const seen = new Set<string>();
    const uniqueManualOptions = manualOptions.filter((option) => {
      if (seen.has(option.modelId)) return false;
      seen.add(option.modelId);
      return true;
    });

    return [...mainOptions, ...uniqueManualOptions];
  }

  getModelDefinition(modelId: string): ModelDefinition | undefined {
    const definition = this.currentConfig.modelDefinitions?.[modelId];
    if (definition) {
      return definition;
    }

    // For unknown models, return an implicit custom definition to match legacy behavior.
    if (!modelId.startsWith('gemini-') || this.isCustomProvider) {
      return {
        tier: 'custom',
        features: {},
      };
    }

    return undefined;
  }

  getModelDefinitions(): Record<string, ModelDefinition> {
    return this.currentConfig.modelDefinitions ?? {};
  }

  /**
   * Returns the context window size (in tokens) for the given model, reading
   * the `contextWindow` field from its model definition (resolving aliases
   * such as 'auto' first). Falls back to DEFAULT_CONTEXT_WINDOW when the
   * definition does not declare one.
   */
  getContextWindow(modelId: string): number {
    const resolvedId = this.resolveModelId(modelId);
    return (
      this.getModelDefinition(resolvedId)?.contextWindow ??
      DEFAULT_CONTEXT_WINDOW
    );
  }

  private matches(
    condition: ResolutionCondition,
    context: ResolutionContext,
  ): boolean {
    return Object.entries(condition).every(([key, value]) => {
      if (value === undefined) return true;

      switch (key) {
        case 'useCustomTools':
          return value === context.useCustomTools;
        case 'requestedModels':
          return (
            Array.isArray(value) &&
            !!context.requestedModel &&
            value.includes(context.requestedModel)
          );
        default:
          return false;
      }
    });
  }

  // Resolves a model ID to a concrete model ID based on the provided context.
  resolveModelId(
    requestedName: string,
    context: ResolutionContext = {},
  ): string {
    const resolution = this.currentConfig.modelIdResolutions?.[requestedName];
    if (!resolution) {
      return requestedName;
    }

    for (const ctx of resolution.contexts ?? []) {
      if (this.matches(ctx.condition, context)) {
        return ctx.target;
      }
    }

    return resolution.default;
  }

  // Resolves a classifier model ID to a concrete model ID based on the provided context.
  resolveClassifierModelId(
    tier: string,
    requestedModel: string,
    context: ResolutionContext = {},
  ): string {
    const resolution = this.currentConfig.classifierIdResolutions?.[tier];
    const fullContext: ResolutionContext = { ...context, requestedModel };

    if (!resolution) {
      // Fallback to regular model resolution if no classifier-specific rule exists
      return this.resolveModelId(tier, fullContext);
    }

    for (const ctx of resolution.contexts ?? []) {
      if (this.matches(ctx.condition, fullContext)) {
        return ctx.target;
      }
    }

    return resolution.default;
  }

  getModelChain(chainName: string): ModelPolicy[] | undefined {
    return this.currentConfig.modelChains?.[chainName];
  }

  /**
   * Fetches a chain template and resolves all model IDs within it
   * based on the provided context.
   */
  resolveChain(
    chainName: string,
    context: ResolutionContext = {},
  ): ModelPolicy[] | undefined {
    const template = this.currentConfig.modelChains?.[chainName];
    if (!template) {
      return undefined;
    }
    // Map through the template and resolve each model ID. The actions and
    // stateTransitions maps are cloned per call so that callers cannot mutate
    // the shared chain template and leak state across requests.
    return template.map((policy) => ({
      ...policy,
      actions: { ...policy.actions },
      stateTransitions: { ...policy.stateTransitions },
      model: this.resolveModelId(policy.model, context),
    }));
  }

  registerRuntimeModelConfig(aliasName: string, alias: ModelConfigAlias): void {
    this.runtimeAliases[aliasName] = alias;
  }

  registerRuntimeModelOverride(override: ModelConfigOverride): void {
    this.runtimeOverrides.push(override);
  }

  clearRuntimeOverrides(): void {
    this.runtimeOverrides.length = 0;
  }

  /**
   * Resolves a model configuration by merging settings from aliases and applying overrides.
   *
   * The resolution follows a linear application pipeline:
   *
   * 1. Alias Chain Resolution:
   *    Builds the inheritance chain from root to leaf. Configurations are merged starting from
   *    the root, so that children naturally override parents.
   *
   * 2. Override Level Assignment:
   *    Overrides are matched against the hierarchy and assigned a "Level" for application:
   *    - Level 0: Broad matches (Global or Resolved Model name).
   *    - Level 1..N: Hierarchy matches (from Root-most alias to Leaf-most alias).
   *
   * 3. Precedence & Application:
   *    Overrides are applied in order of their Level (ASC), then Specificity (ASC), then
   *    Configuration Order (ASC). This ensures that more targeted and "deeper" rules
   *    naturally layer on top of broader ones.
   *
   * 4. Orthogonality:
   *    All fields (including 'model') are treated equally. A more specific or deeper override
   *    can freely change any setting, including the target model name.
   */
  private internalGetResolvedConfig(context: ModelConfigKey): {
    model: string | undefined;
    generateContentConfig: SparkleGenerateContentConfig;
  } {
    const {
      aliases = {},
      customAliases = {},
      overrides = [],
      customOverrides = [],
    } = this.currentConfig || {};

    const allAliases = {
      ...aliases,
      ...customAliases,
      ...this.runtimeAliases,
    };

    const { aliasChain, baseModel, resolvedConfig } = this.resolveAliasChain(
      context.model,
      allAliases,
      context.isChatModel,
    );

    const modelToLevel = this.buildModelLevelMap(aliasChain, baseModel);
    const allOverrides = [
      ...overrides,
      ...customOverrides,
      ...this.runtimeOverrides,
    ];
    const matches = this.findMatchingOverrides(
      allOverrides,
      context,
      modelToLevel,
    );

    this.sortOverrides(matches);

    let currentConfig: ModelConfig = {
      model: baseModel,
      generateContentConfig: resolvedConfig,
    };

    for (const match of matches) {
      currentConfig = ModelConfigService.merge(
        currentConfig,
        match.modelConfig,
      );
    }

    return {
      model: currentConfig.model,
      generateContentConfig: currentConfig.generateContentConfig ?? {},
    };
  }

  private resolveAliasChain(
    requestedModel: string,
    allAliases: Record<string, ModelConfigAlias>,
    isChatModel?: boolean,
  ): {
    aliasChain: string[];
    baseModel: string | undefined;
    resolvedConfig: GenerateContentConfig;
  } {
    const aliasChain: string[] = [];

    if (allAliases[requestedModel]) {
      let current: string | undefined = requestedModel;
      const visited = new Set<string>();
      while (current) {
        const alias: ModelConfigAlias = allAliases[current];
        if (!alias) {
          throw new Error(`Alias "${current}" not found.`);
        }
        if (visited.size >= MAX_ALIAS_CHAIN_DEPTH) {
          throw new Error(
            `Alias inheritance chain exceeded maximum depth of ${MAX_ALIAS_CHAIN_DEPTH}.`,
          );
        }
        if (visited.has(current)) {
          throw new Error(
            `Circular alias dependency: ${[...visited, current].join(' -> ')}`,
          );
        }
        visited.add(current);
        aliasChain.push(current);
        current = alias.extends;
      }

      // Root-to-Leaf chain for merging and level assignment.
      const reversedChain = [...aliasChain].reverse();
      let resolvedConfig: ModelConfig = {};
      for (const aliasName of reversedChain) {
        const alias = allAliases[aliasName];
        resolvedConfig = ModelConfigService.merge(
          resolvedConfig,
          alias.modelConfig,
        );
      }
      return {
        aliasChain: reversedChain,
        baseModel: resolvedConfig.model,
        resolvedConfig: resolvedConfig.generateContentConfig ?? {},
      };
    }

    if (isChatModel) {
      const fallbackAlias = 'chat-base';
      if (allAliases[fallbackAlias]) {
        const fallbackResolution = this.resolveAliasChain(
          fallbackAlias,
          allAliases,
        );
        return {
          aliasChain: [...fallbackResolution.aliasChain, requestedModel],
          baseModel: requestedModel,
          resolvedConfig: fallbackResolution.resolvedConfig,
        };
      }
    }

    return {
      aliasChain: [requestedModel],
      baseModel: requestedModel,
      resolvedConfig: {},
    };
  }

  private buildModelLevelMap(
    aliasChain: string[],
    baseModel: string | undefined,
  ): Map<string, number> {
    const modelToLevel = new Map<string, number>();
    // Global and Model name are both level 0.
    if (baseModel) {
      modelToLevel.set(baseModel, 0);
    }
    // Alias chain starts at level 1.
    aliasChain.forEach((name, i) => modelToLevel.set(name, i + 1));
    return modelToLevel;
  }

  private findMatchingOverrides(
    overrides: ModelConfigOverride[],
    context: ModelConfigKey,
    modelToLevel: Map<string, number>,
  ): Array<{
    specificity: number;
    level: number;
    modelConfig: ModelConfig;
    index: number;
  }> {
    return overrides
      .map((override, index) => {
        const matchEntries = Object.entries(override.match);
        if (matchEntries.length === 0) return null;

        let matchedLevel = 0; // Default to Global
        const isMatch = matchEntries.every(([key, value]) => {
          if (key === 'model') {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            const level = modelToLevel.get(value as string);
            if (level === undefined) return false;
            matchedLevel = level;
            return true;
          }
          if (key === 'overrideScope' && value === 'core') {
            return context.overrideScope === 'core' || !context.overrideScope;
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          return context[key as keyof ModelConfigKey] === value;
        });

        return isMatch
          ? {
              specificity: matchEntries.length,
              level: matchedLevel,
              modelConfig: override.modelConfig,
              index,
            }
          : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }

  private sortOverrides(
    matches: Array<{ specificity: number; level: number; index: number }>,
  ): void {
    matches.sort((a, b) => {
      if (a.level !== b.level) {
        return a.level - b.level;
      }
      if (a.specificity !== b.specificity) {
        return a.specificity - b.specificity;
      }
      return a.index - b.index;
    });
  }

  getResolvedConfig(context: ModelConfigKey): ResolvedModelConfig {
    const resolved = this.internalGetResolvedConfig(context);

    if (!resolved.model) {
      throw new Error(
        `Could not resolve a model name for alias "${context.model}". Please ensure the alias chain or a matching override specifies a model.`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    return {
      model: resolved.model,
      generateContentConfig: resolved.generateContentConfig,
    } as ResolvedModelConfig;
  }

  static isObject(item: unknown): item is Record<string, unknown> {
    return !!item && typeof item === 'object' && !Array.isArray(item);
  }

  /**
   * Merges an override `ModelConfig` into a base `ModelConfig`.
   * The override's model name takes precedence if provided.
   * The `generateContentConfig` properties are deeply merged.
   */
  static merge(base: ModelConfig, override: ModelConfig): ModelConfig {
    return {
      model: override.model ?? base.model,
      generateContentConfig: ModelConfigService.deepMerge(
        base.generateContentConfig,
        override.generateContentConfig,
      ),
    };
  }

  static deepMerge(
    config1: SparkleGenerateContentConfig | undefined,
    config2: SparkleGenerateContentConfig | undefined,
  ): SparkleGenerateContentConfig {
    return ModelConfigService.genericDeepMerge(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      config1 as Record<string, unknown> | undefined,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      config2 as Record<string, unknown> | undefined,
    ) as GenerateContentConfig;
  }

  private static genericDeepMerge(
    ...objects: Array<Record<string, unknown> | undefined>
  ): Record<string, unknown> {
    return objects.reduce((acc: Record<string, unknown>, obj) => {
      if (!obj) {
        return acc;
      }

      Object.keys(obj).forEach((key) => {
        const accValue = acc[key];
        const objValue = obj[key];

        // For now, we only deep merge objects, and not arrays. This is because
        // If we deep merge arrays, there is no way for the user to completely
        // override the base array.
        // TODO(joshualitt): Consider knobs here, i.e. opt-in to deep merging
        // arrays on a case-by-case basis.
        if (
          ModelConfigService.isObject(accValue) &&
          ModelConfigService.isObject(objValue)
        ) {
          acc[key] = ModelConfigService.genericDeepMerge(accValue, objValue);
        } else {
          acc[key] = objValue;
        }
      });

      return acc;
    }, {});
  }
}
