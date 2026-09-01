/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse,
  GoogleGenAI,
} from '@google/genai';
import type { LlmRole } from '../telemetry/llmRole.js';
import type { ContentGenerator } from './contentGenerator.js';
import { toContents } from './partUtils.js';
import { prepareGeminiContents } from '../utils/historyHardening.js';

/**
 * A ContentGenerator backed by the Google GenAI SDK (@google/genai).
 *
 * It adapts canonical conversation contents to Gemini API wire invariants:
 * - Strips internal thought parts (`thought: true`)
 * - Scrubs non-standard / client-internal fields from Part objects
 * - Injects synthetic `thoughtSignature` on active function-call loops
 * - Coalesces consecutive same-role turns resulting from thought stripping
 */
export class GoogleGenAiContentGenerator implements ContentGenerator {
  constructor(private readonly models: GoogleGenAI['models']) {}

  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<GenerateContentResponse> {
    const sanitizedRequest = this.prepareRequest(request);
    return this.models.generateContent(sanitizedRequest);
  }

  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const sanitizedRequest = this.prepareRequest(request);
    return this.models.generateContentStream(sanitizedRequest);
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    const contents = toContents(request.contents, true);
    const preparedContents = prepareGeminiContents(contents);
    return this.models.countTokens({
      ...request,
      contents: preparedContents,
    });
  }

  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    return this.models.embedContent(request);
  }

  private prepareRequest(
    request: GenerateContentParameters,
  ): GenerateContentParameters {
    const contents = toContents(request.contents, true);
    const preparedContents = prepareGeminiContents(contents);
    return {
      ...request,
      contents: preparedContents,
    };
  }
}
