/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type semver from 'semver';
import { getPackageJson, debugLogger } from 'sparkle-cli-core';
import type { LoadedSettings } from '../../config/settings.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const FETCH_TIMEOUT_MS = 2000;

// Replicating the bits of UpdateInfo we need from update-notifier
export interface UpdateInfo {
  latest: string;
  current: string;
  name: string;
  type?: semver.ReleaseType;
}

export interface UpdateObject {
  message: string;
  update: UpdateInfo;
  isUpdating?: boolean;
}

export async function checkForUpdates(
  settings: LoadedSettings,
): Promise<UpdateObject | null> {
  try {
    if (!settings.merged.general.enableAutoUpdateNotification) {
      return null;
    }
    // Skip update check when running from source (development mode)
    if (process.env['DEV'] === 'true') {
      return null;
    }
    const packageJson = await getPackageJson(__dirname);
    if (!packageJson || !packageJson.name || !packageJson.version) {
      return null;
    }

    const { name, version: currentVersion } = packageJson;
    const [latestVersionModule, semverModule] = await Promise.all([
      import('latest-version'),
      import('semver'),
    ]);
    const latestVersion = latestVersionModule.default;
    const semver = semverModule.default;

    const latestUpdate = await latestVersion(name);
    if (!latestUpdate) {
      return null;
    }

    if (semver.gt(latestUpdate, currentVersion)) {
      const message = `Sparkle CLI update available! ${currentVersion} → ${latestUpdate}`;
      const type = semver.diff(latestUpdate, currentVersion) || undefined;
      return {
        message,
        update: {
          latest: latestUpdate,
          current: currentVersion,
          name,
          type,
        },
      };
    }

    return null;
  } catch (e) {
    debugLogger.warn('Failed to check for updates: ' + e);
    return null;
  }
}
