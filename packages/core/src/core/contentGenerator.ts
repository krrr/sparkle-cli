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
} from '@google/genai';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as os from 'node:os';
import type { Config } from '../config/config.js';
import { loadApiKey } from './apiKeyCredentialStorage.js';

import { LoggingContentGenerator } from './loggingContentGenerator.js';
import { InstallationManager } from '../utils/installationManager.js';
import { FakeContentGenerator } from './fakeContentGenerator.js';
import { parseCustomHeaders } from '../utils/customHeaderUtils.js';
import { determineSurface } from '../utils/surface.js';
import { RecordingContentGenerator } from './recordingContentGenerator.js';
import { getVersion, resolveModel } from '../../index.js';
import type { LlmRole } from '../telemetry/llmRole.js';
import type { UserTierId, GeminiUserTier } from '../userTier.js';

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

  userTier?: UserTierId;

  userTierName?: string;

  paidTier?: GeminiUserTier;
}

export enum AuthType {
  USE_GEMINI = 'gemini-api-key',
  GATEWAY = 'gateway',
}

/**
 * Detects the best authentication type based on environment variables.
 *
 * Checks in order:
 * 1. GOOGLE_GEMINI_BASE_URL -> GATEWAY
 * 2. GEMINI_API_KEY -> USE_GEMINI
 */
export function getAuthTypeFromEnv(): AuthType | undefined {
  if (process.env['GOOGLE_GEMINI_BASE_URL']) {
    return AuthType.GATEWAY;
  }
  if (process.env['GEMINI_API_KEY']) {
    return AuthType.USE_GEMINI;
  }
  return undefined;
}

export type ContentGeneratorConfig = {
  apiKey?: string;
  authType?: AuthType;
  proxy?: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
};

function validateBaseUrl(baseUrl: string): void {
  try {
    new URL(baseUrl);
  } catch {
    throw new Error(`Invalid custom base URL: ${baseUrl}`);
  }
}

export async function createContentGeneratorConfig(
  config: Config,
  authType: AuthType | undefined,
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

  const geminiApiKey =
    apiKey || getEnv('GEMINI_API_KEY') || (await loadApiKey()) || undefined;

  if (authType === AuthType.USE_GEMINI && geminiApiKey) {
    contentGeneratorConfig.apiKey = geminiApiKey;

    return contentGeneratorConfig;
  }

  if (authType === AuthType.GATEWAY) {
    contentGeneratorConfig.apiKey = apiKey || getEnv('GEMINI_API_KEY') || '';

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
      const fakeGenerator = await FakeContentGenerator.fromFile(
        gcConfig.fakeResponses,
      );
      return new LoggingContentGenerator(fakeGenerator, gcConfig);
    }
    const version = await getVersion();
    const model = resolveModel(
      gcConfig.getModel(),
      config.authType === AuthType.USE_GEMINI ||
        ((await gcConfig.getGemini31Launched?.()) ?? false),
      false,
      gcConfig.getHasAccessToPreviewModel?.() ?? true,
      gcConfig,
      gcConfig.hasGemini35FlashGAAccess?.() ?? false,
    );
    const customHeadersEnv =
      process.env['GEMINI_CLI_CUSTOM_HEADERS'] || undefined;
    const clientName = gcConfig.getClientName();
    const surface = determineSurface();

    let userAgent: string;
    // Use unified format for VS Code traffic.
    // Note: We don't automatically assume a2a-server is VS Code,
    // as it could be used by other clients unless the surface explicitly says 'vscode'.
    if (clientName === 'acp-vscode' || surface === 'vscode') {
      const osTypeMap: Record<string, string> = {
        darwin: 'macOS',
        win32: 'Windows',
        linux: 'Linux',
      };
      const osType = osTypeMap[process.platform] || process.platform;
      const osVersion = os.release();
      const arch = process.arch;

      const vscodeVersion = process.env['TERM_PROGRAM_VERSION'] || 'unknown';
      const hostPath = `VSCode/${vscodeVersion}`;

      userAgent = `CloudCodeVSCode/${version} (aidev_client; os_type=${osType}; os_version=${osVersion}; arch=${arch}; host_path=${hostPath}; proxy_client=geminicli)`;
    } else {
      const userAgentPrefix = clientName
        ? `GeminiCLI-${clientName}`
        : 'GeminiCLI';
      userAgent = `${userAgentPrefix}/${version}/${model} (${process.platform}; ${process.arch}; ${surface})`;
    }

    const customHeadersMap = parseCustomHeaders(customHeadersEnv);
    const apiKeyAuthMechanism =
      process.env['GEMINI_API_KEY_AUTH_MECHANISM'] || 'x-goog-api-key';
    const apiVersionEnv = process.env['GOOGLE_GENAI_API_VERSION'];

    const baseHeaders: Record<string, string> = {
      'User-Agent': userAgent,
      ...customHeadersMap,
    };

    if (
      apiKeyAuthMechanism === 'bearer' &&
      config.authType === AuthType.USE_GEMINI &&
      config.apiKey
    ) {
      baseHeaders['Authorization'] = `Bearer ${config.apiKey}`;
    }

    if (
      config.authType === AuthType.USE_GEMINI ||
      config.authType === AuthType.GATEWAY
    ) {
      let headers: Record<string, string> = { ...baseHeaders };
      if (config.customHeaders) {
        headers = { ...headers, ...config.customHeaders };
      }
      if (gcConfig?.getUsageStatisticsEnabled()) {
        const installationManager = new InstallationManager();
        const installationId = installationManager.getInstallationId();
        headers = {
          ...headers,
          'x-gemini-api-privileged-user-id': `${installationId}`,
        };
      }
      if (config.authType === AuthType.GATEWAY && config.apiKey === '') {
        headers['x-goog-api-key'] = '';
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

      const httpOptions: {
        baseUrl?: string;
        headers: Record<string, string>;
      } = { headers };

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
        apiKey:
          config.authType === AuthType.GATEWAY
            ? config.apiKey
            : config.apiKey === ''
              ? undefined
              : config.apiKey,
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
      return new LoggingContentGenerator(googleGenAI.models, gcConfig);
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
