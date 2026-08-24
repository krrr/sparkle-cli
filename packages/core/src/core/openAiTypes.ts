/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Types for the OpenAI Chat Completions API (and the embeddings API).
 *
 * Only the subset of the OpenAI API surface needed by the OpenAI-compatible
 * content generator adapter is defined here. See:
 * https://platform.openai.com/docs/api-reference/chat
 */

/** A single message in the OpenAI chat format. */
export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAiContentPart[] | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
  /** DeepSeek-specific: reasoning content produced by the model. */
  reasoning_content?: string;
  /** OpenRouter-style normalized reasoning text. */
  reasoning?: string;
  name?: string;
}

export interface OpenAiContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

/** A function tool definition in the OpenAI format. */
export interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

/** A complete (non-streaming) function call produced by the model. */
export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON-encoded arguments. */
    arguments: string;
  };
}

/** A fragment of a function call as delivered in a streaming delta. */
export interface OpenAiToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /**
   * DeepSeek: tokens served from the prompt cache (a subset of
   * prompt_tokens). Absent when caching is not in effect.
   */
  prompt_cache_hit_tokens?: number;
  /** DeepSeek: prompt tokens that were not served from the cache. */
  prompt_cache_miss_tokens?: number;
  /**
   * OpenAI: cached prompt token breakdown (cached_tokens is a subset of
   * prompt_tokens).
   */
  prompt_tokens_details?: { cached_tokens?: number };
  [key: string]: unknown;
}

/** The request body for the Chat Completions API. */
export interface OpenAiRequest {
  model: string;
  messages: OpenAiMessage[];
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  tools?: OpenAiTool[];
  tool_choice?:
    | 'none'
    | 'required'
    | 'auto'
    | { type: 'function'; function: { name: string } };
  response_format?:
    | { type: 'json_object' }
    | {
        type: 'json_schema';
        json_schema: { name: string; schema: Record<string, unknown> };
      };
  /**
   * Reasoning effort level (DeepSeek: 'low' | 'high' | 'max'). A top-level
   * parameter, not an extra_body field.
   */
  reasoning_effort?: 'low' | 'medium' | 'high' | 'max' | string;
  /**
   * Provider-specific extra body fields (e.g. DeepSeek's `thinking`).
   * Spread at the top level of the JSON payload.
   */
  extra_body?: Record<string, unknown>;
}

/** A single chunk of a streaming Chat Completions response. */
export interface OpenAiStreamChunk {
  id?: string;
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: OpenAiToolCallDelta[];
    };
    finish_reason?: string | null;
    index?: number;
  }>;
  usage?: OpenAiUsage;
}

/** A non-streaming Chat Completions response. */
export interface OpenAiChatCompletion {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      reasoning_content?: string;
      reasoning?: string;
      tool_calls?: OpenAiToolCall[];
    };
    finish_reason?: string | null;
    index?: number;
  }>;
  usage?: OpenAiUsage;
}

/** A non-streaming embeddings response. */
export interface OpenAiEmbeddingsResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
  model?: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

/** The error envelope returned by OpenAI-compatible APIs. */
export interface OpenAiErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
    param?: string | null;
  };
}
