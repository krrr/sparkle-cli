/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { AuthProviderType } from '../config/config.js';

const ExtensionsSettingSchema = z.object({
  extensionsEnabled: z.boolean().optional(),
});

const CliFeatureSettingSchema = z.object({
  extensionsSetting: ExtensionsSettingSchema.optional(),
  unmanagedCapabilitiesEnabled: z.boolean().optional(),
});

const McpServerConfigSchema = z.object({
  url: z.string().optional(),
  type: z.enum(['sse', 'http']).optional(),
  trust: z.boolean().optional(),
  includeTools: z.array(z.string()).optional(),
  excludeTools: z.array(z.string()).optional(),
});

const RequiredMcpServerOAuthSchema = z.object({
  scopes: z.array(z.string()).optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

export const RequiredMcpServerConfigSchema = z.object({
  // Connection (required for forced servers)
  url: z.string(),
  type: z.enum(['sse', 'http']),

  // Auth
  authProviderType: z.nativeEnum(AuthProviderType).optional(),
  oauth: RequiredMcpServerOAuthSchema.optional(),
  targetAudience: z.string().optional(),
  targetServiceAccount: z.string().optional(),
  headers: z.record(z.string()).optional(),

  // Common
  trust: z.boolean().optional(),
  timeout: z.number().optional(),
  description: z.string().optional(),

  // Tool filtering
  includeTools: z.array(z.string()).optional(),
  excludeTools: z.array(z.string()).optional(),
});

export type RequiredMcpServerConfig = z.infer<
  typeof RequiredMcpServerConfigSchema
>;

export const McpConfigDefinitionSchema = z.object({
  mcpServers: z.record(McpServerConfigSchema).optional(),
  requiredMcpServers: z.record(RequiredMcpServerConfigSchema).optional(),
});

export type McpConfigDefinition = z.infer<typeof McpConfigDefinitionSchema>;

const McpSettingSchema = z.object({
  mcpEnabled: z.boolean().optional(),
  mcpConfigJson: z.string().optional(),
});

// Schema for internal application use (parsed mcpConfig)
export const AdminControlsSettingsSchema = z.object({
  strictModeDisabled: z.boolean().optional(),
  mcpSetting: z
    .object({
      mcpEnabled: z.boolean().optional(),
      mcpConfig: McpConfigDefinitionSchema.optional(),
      requiredMcpConfig: z.record(RequiredMcpServerConfigSchema).optional(),
    })
    .optional(),
  cliFeatureSetting: CliFeatureSettingSchema.optional(),
});

export type AdminControlsSettings = z.infer<typeof AdminControlsSettingsSchema>;

export const FetchAdminControlsResponseSchema = z.object({
  // TODO: deprecate once backend stops sending this field
  secureModeEnabled: z.boolean().optional(),
  strictModeDisabled: z.boolean().optional(),
  mcpSetting: McpSettingSchema.optional(),
  cliFeatureSetting: CliFeatureSettingSchema.optional(),
  adminControlsApplicable: z.boolean().optional(),
});

export type FetchAdminControlsResponse = z.infer<
  typeof FetchAdminControlsResponseSchema
>;
