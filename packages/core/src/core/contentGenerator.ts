/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GoogleGenAI,
  type CountTokensResponse,
  type GenerateContentResponse,
  type GenerateContentParameters,
  type CountTokensParameters,
  type EmbedContentResponse,
  type EmbedContentParameters,
  type HttpOptions,
} from '@google/genai';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Config } from '../config/config.js';
import { ProviderType } from '../config/constants.js';
import { LoggingContentGenerator } from './loggingContentGenerator.js';
import { FakeContentGenerator } from './fakeContentGenerator.js';
import { parseCustomHeaders } from '../utils/customHeaderUtils.js';
import { buildUserAgent } from '../utils/surface.js';
import { RecordingContentGenerator } from './recordingContentGenerator.js';
import { getVersion, resolveModel } from '../../index.js';
import type { LlmRole } from '../telemetry/llmRole.js';
import {
  DEFAULT_OPENAI_BASE_URL,
  OpenAiCompatibleGenerator,
  type OpenAiProvider,
} from './openAiCompatibleGenerator.js';
import { GoogleGenAiContentGenerator } from './googleGenAiContentGenerator.js';

/**
 * Interface abstracting the core functionalities for generating content and counting tokens.
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;
}

export type ContentGeneratorConfig = {
  apiKey?: string;
  authType?: ProviderType;
  proxy?: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
};

/**
 * Determines the OpenAI-compatible provider flavor.
 *
 * Priority:
 * 1. OPENAI_PROVIDER environment variable
 * 2. Model name prefix (e.g. `deepseek/...`)
 * 3. Model name pattern (e.g. `deepseek-v4-flash`, `deepseek-v4-pro`)
 * 4. Base URL hostname (e.g. api.deepseek.com)
 * 5. 'openai'
 */
export function getOpenAiProvider(
  gcConfig: Config,
  config: ContentGeneratorConfig,
  model: string,
): OpenAiProvider {
  const explicit =
    (gcConfig.env && gcConfig.env['OPENAI_PROVIDER']) || process.env['OPENAI_PROVIDER'];
  if (explicit === 'deepseek' || explicit === 'openai' || explicit === 'custom') {
    return explicit;
  }
  if (model.toLowerCase().startsWith('deepseek')) {
    return 'deepseek';
  }
  const baseUrl = config.baseUrl ?? '';
  if (baseUrl.includes('deepseek')) {
    return 'deepseek';
  }
  return 'openai';
}

function validateBaseUrl(baseUrl: string): void {
  try {
    new URL(baseUrl);
  } catch {
    throw new Error(`Invalid custom base URL: ${baseUrl}`);
  }
}

export async function createContentGeneratorConfig(
  config: Config,
  authType: ProviderType | undefined,
  apiKey?: string,
  baseUrl?: string,
  customHeaders?: Record<string, string>,
): Promise<ContentGeneratorConfig> {
  const contentGeneratorConfig: ContentGeneratorConfig = {
    authType,
    proxy: config?.getProxy(),
    baseUrl,
    customHeaders,
  };

  const getEnv = (key: string) => {
    if (config?.env && config.env[key] !== undefined) {
      return config.env[key];
    }
    return process.env[key];
  };

  const geminiApiKey = apiKey || getEnv('GEMINI_API_KEY') || undefined;

  if (authType === ProviderType.USE_GEMINI && geminiApiKey) {
    contentGeneratorConfig.apiKey = geminiApiKey;

    return contentGeneratorConfig;
  }

  if (authType === ProviderType.USE_OPENAI) {
    contentGeneratorConfig.apiKey = apiKey || getEnv('OPENAI_API_KEY') || '';
    contentGeneratorConfig.baseUrl =
      baseUrl || getEnv('OPENAI_BASE_URL') || DEFAULT_OPENAI_BASE_URL;

    return contentGeneratorConfig;
  }

  return contentGeneratorConfig;
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
  gcConfig: Config,
  _sessionId?: string,
): Promise<ContentGenerator> {
  const generator = await (async () => {
    if (gcConfig.fakeResponsesNonStrict) {
      const fakeGenerator = await FakeContentGenerator.fromFile(
        gcConfig.fakeResponsesNonStrict,
        { nonStrict: true },
      );
      return new LoggingContentGenerator(fakeGenerator, gcConfig);
    }
    if (gcConfig.fakeResponses) {
      const fakeGenerator = await FakeContentGenerator.fromFile(gcConfig.fakeResponses);
      return new LoggingContentGenerator(fakeGenerator, gcConfig);
    }
    const version = await getVersion();
    const customHeadersEnv = process.env['SPARKLE_CLI_CUSTOM_HEADERS'] || undefined;
    const userAgent = buildUserAgent(gcConfig.getClientName(), version);

    const baseHeaders: Record<string, string> = {
      'User-Agent': userAgent,
      ...parseCustomHeaders(customHeadersEnv),
    };
    const headers: Record<string, string> = {
      ...baseHeaders,
      ...config.customHeaders,
    };

    if (config.authType === ProviderType.USE_GEMINI) {
      const keyAuthMech =
        process.env['GEMINI_API_KEY_AUTH_MECHANISM'] || 'x-goog-api-key';
      const apiVersionEnv = process.env['GOOGLE_GENAI_API_VERSION'];
      if (keyAuthMech === 'bearer' && config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }
      let baseUrl = config.baseUrl;
      if (!baseUrl) {
        const envBaseUrl = process.env['GOOGLE_GEMINI_BASE_URL'];
        if (envBaseUrl) {
          validateBaseUrl(envBaseUrl);
          baseUrl = envBaseUrl;
        }
      } else {
        validateBaseUrl(baseUrl);
      }

      // Preserve legacy GATEWAY behavior: a custom endpoint without an API key
      // sends an empty x-goog-api-key header instead of attempting default
      // OAuth/ADC authentication, since the endpoint handles authentication.
      const useEmptyApiKeyForCustomEndpoint = !config.apiKey && !!baseUrl;
      if (useEmptyApiKeyForCustomEndpoint) {
        headers['x-goog-api-key'] = '';
      }

      const httpOptions: HttpOptions = { headers };
      if (baseUrl) {
        httpOptions.baseUrl = baseUrl;
      }

      const proxyUrl = config.proxy?.trim();
      const proxyAgent = proxyUrl
        ? baseUrl?.startsWith('http://')
          ? new HttpProxyAgent(proxyUrl)
          : new HttpsProxyAgent(proxyUrl)
        : undefined;
      const googleGenAI = new GoogleGenAI({
        apiKey: useEmptyApiKeyForCustomEndpoint ? '' : config.apiKey,
        httpOptions,
        ...(apiVersionEnv && { apiVersion: apiVersionEnv }),
        // Merge proxy into googleAuthOptions if it exists
        ...(proxyAgent && {
          googleAuthOptions: {
            clientOptions: {
              transporterOptions: { agent: proxyAgent },
            },
          },
        }),
      });
      return new LoggingContentGenerator(
        new GoogleGenAiContentGenerator(googleGenAI.models),
        gcConfig,
      );
    } else if (config.authType === ProviderType.USE_OPENAI) {
      const model = resolveModel(gcConfig.getModel(), gcConfig);
      const provider = getOpenAiProvider(gcConfig, config, model);
      return new LoggingContentGenerator(
        new OpenAiCompatibleGenerator({
          apiKey: config.apiKey ?? '',
          baseUrl: config.baseUrl ?? DEFAULT_OPENAI_BASE_URL,
          provider,
          proxy: config.proxy,
          httpOptions: { headers },
        }),
        gcConfig,
      );
    }
    throw new Error(
      `Error creating contentGenerator: Unsupported authType: ${config.authType}`,
    );
  })();

  if (gcConfig.recordResponses) {
    return new RecordingContentGenerator(generator, gcConfig.recordResponses);
  }

  return generator;
}
