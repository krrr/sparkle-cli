/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import {
  type FetchAdminControlsResponse,
  FetchAdminControlsResponseSchema,
  McpConfigDefinitionSchema,
  type AdminControlsSettings,
} from './types.js';

export function sanitizeAdminSettings(
  settings: FetchAdminControlsResponse,
): AdminControlsSettings {
  const result = FetchAdminControlsResponseSchema.safeParse(settings);
  if (!result.success) {
    return {};
  }
  const sanitized = result.data;
  let mcpConfig;

  if (sanitized.mcpSetting?.mcpConfigJson) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const parsed = JSON.parse(sanitized.mcpSetting.mcpConfigJson);
      const validationResult = McpConfigDefinitionSchema.safeParse(parsed);

      if (validationResult.success) {
        mcpConfig = validationResult.data;
        // Sort include/exclude tools for stable comparison
        if (mcpConfig.mcpServers) {
          for (const server of Object.values(mcpConfig.mcpServers)) {
            if (server.includeTools) {
              server.includeTools.sort();
            }
            if (server.excludeTools) {
              server.excludeTools.sort();
            }
          }
        }
        if (mcpConfig.requiredMcpServers) {
          for (const server of Object.values(mcpConfig.requiredMcpServers)) {
            if (server.includeTools) {
              server.includeTools.sort();
            }
            if (server.excludeTools) {
              server.excludeTools.sort();
            }
          }
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }

  // Apply defaults (secureModeEnabled is supported for backward compatibility)
  let strictModeDisabled = false;
  if (sanitized.strictModeDisabled !== undefined) {
    strictModeDisabled = sanitized.strictModeDisabled;
  } else if (sanitized.secureModeEnabled !== undefined) {
    strictModeDisabled = !sanitized.secureModeEnabled;
  }

  return {
    strictModeDisabled,
    cliFeatureSetting: {
      ...sanitized.cliFeatureSetting,
      extensionsSetting: {
        extensionsEnabled:
          sanitized.cliFeatureSetting?.extensionsSetting?.extensionsEnabled ??
          false,
      },
      unmanagedCapabilitiesEnabled:
        sanitized.cliFeatureSetting?.unmanagedCapabilitiesEnabled ?? false,
    },
    mcpSetting: {
      mcpEnabled: sanitized.mcpSetting?.mcpEnabled ?? false,
      mcpConfig: mcpConfig ?? {},
      ...(mcpConfig?.requiredMcpServers && {
        requiredMcpConfig: mcpConfig.requiredMcpServers,
      }),
    },
  };
}

/**
 * Returns a standardized error message for features disabled by admin settings.
 *
 * @param featureName The name of the disabled feature
 * @param config The application config
 * @returns The formatted error message
 */
export function getAdminErrorMessage(
  featureName: string,
  _config: Config | undefined,
): string {
  return `${featureName} is disabled by your administrator. To enable it, please request an update to the settings at: https://goo.gle/manage-gemini-cli`;
}

/**
 * Returns a standardized error message for MCP servers blocked by the admin allowlist.
 *
 * @param blockedServers List of blocked server names
 * @param config The application config
 * @returns The formatted error message
 */
export function getAdminBlockedMcpServersMessage(
  blockedServers: string[],
  _config: Config | undefined,
): string {
  const count = blockedServers.length;
  const serverText = count === 1 ? 'server is' : 'servers are';

  return `${count} MCP ${serverText} not allowlisted by your administrator. To enable ${
    count === 1 ? 'it' : 'them'
  }, please request an update to the settings at: https://goo.gle/manage-gemini-cli`;
}
