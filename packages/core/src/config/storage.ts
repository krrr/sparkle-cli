/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import {
  SPARKLE_DIR,
  homedir,
  isSubpath,
  resolveToRealPath,
  normalizePath,
} from '../utils/paths.js';
import { ProjectRegistry } from './projectRegistry.js';

export const OAUTH_FILE = 'oauth_creds.json';
export const TRUSTED_FOLDERS_FILENAME = 'trustedFolders.json';
const TMP_DIR_NAME = 'tmp';
const DATA_DIR_NAME = 'data';
const AGENTS_DIR_NAME = '.agents';

export const AUTO_SAVED_POLICY_FILENAME = 'auto-saved.toml';

export class Storage {
  private readonly targetDir: string;
  private sessionId: string | undefined;
  private projectIdentifier: string | undefined;
  private initPromise: Promise<void> | undefined;
  private customPlansDir: string | undefined;

  constructor(targetDir: string, sessionId?: string) {
    this.targetDir = targetDir;
    this.sessionId = sessionId;
  }

  setCustomPlansDir(dir: string | undefined): void {
    this.customPlansDir = dir;
  }

  setSessionId(sessionId: string | undefined): void {
    this.sessionId = sessionId;
  }

  isInitialized(): boolean {
    return !!this.projectIdentifier;
  }

  static getGlobalGeminiDir(): string {
    const homeDir = homedir();
    if (!homeDir) {
      return path.join(os.tmpdir(), SPARKLE_DIR);
    }
    return path.join(homeDir, SPARKLE_DIR);
  }

  static getGlobalAgentsDir(): string {
    const homeDir = homedir();
    if (!homeDir) {
      return '';
    }
    return path.join(homeDir, AGENTS_DIR_NAME);
  }

  static getMcpOAuthTokensPath(): string {
    return path.join(Storage.getGlobalGeminiDir(), 'mcp-oauth-tokens.json');
  }

  static getA2AOAuthTokensPath(): string {
    return path.join(Storage.getGlobalGeminiDir(), 'a2a-oauth-tokens.json');
  }

  static getGlobalSettingsPath(): string {
    return path.join(Storage.getGlobalGeminiDir(), 'settings.json');
  }

  static getInstallationIdPath(): string {
    return path.join(Storage.getGlobalGeminiDir(), 'installation_id');
  }

  static getTrustedFoldersPath(): string {
    if (process.env['SPARKLE_CLI_TRUSTED_FOLDERS_PATH']) {
      return process.env['SPARKLE_CLI_TRUSTED_FOLDERS_PATH'];
    }
    return path.join(Storage.getGlobalGeminiDir(), TRUSTED_FOLDERS_FILENAME);
  }

  static getUserCommandsDir(): string {
    return path.join(Storage.getGlobalGeminiDir(), 'commands');
  }

  static getUserSkillsDir(): string {
    return path.join(Storage.getGlobalGeminiDir(), 'skills');
  }

  static getUserAgentSkillsDir(): string {
    return path.join(Storage.getGlobalAgentsDir(), 'skills');
  }

  static getUserPoliciesDir(): string {
    return path.join(Storage.getGlobalGeminiDir(), 'policies');
  }

  static getUserKeybindingsPath(): string {
    return path.join(Storage.getGlobalGeminiDir(), 'keybindings.json');
  }

  static getUserAgentsDir(): string {
    return path.join(Storage.getGlobalGeminiDir(), 'agents');
  }

  static getAcknowledgedAgentsPath(): string {
    return path.join(
      Storage.getGlobalGeminiDir(),
      'acknowledgments',
      'agents.json',
    );
  }

  static getPolicyIntegrityStoragePath(): string {
    return path.join(Storage.getGlobalGeminiDir(), 'policy_integrity.json');
  }

  private static getSystemConfigDir(): string {
    if (os.platform() === 'darwin') {
      return '/Library/Application Support/SparkleCli';
    } else if (os.platform() === 'win32') {
      return 'C:\\ProgramData\\sparkle-cli';
    } else {
      return '/etc/sparkle-cli';
    }
  }

  static getSystemSettingsPath(): string {
    if (process.env['SPARKLE_CLI_SYSTEM_SETTINGS_PATH']) {
      return process.env['SPARKLE_CLI_SYSTEM_SETTINGS_PATH'];
    }
    return path.join(Storage.getSystemConfigDir(), 'settings.json');
  }

  static getGlobalTempDir(): string {
    return path.join(Storage.getGlobalGeminiDir(), TMP_DIR_NAME);
  }

  static getGlobalDataDir(): string {
    return path.join(Storage.getGlobalGeminiDir(), DATA_DIR_NAME);
  }

  getGeminiDir(): string {
    return path.join(this.targetDir, SPARKLE_DIR);
  }

  /**
   * Checks if the current workspace storage location is the same as the global/user storage location.
   * This handles symlinks and platform-specific path normalization.
   */
  isWorkspaceHomeDir(): boolean {
    return (
      normalizePath(resolveToRealPath(this.targetDir)) ===
      normalizePath(resolveToRealPath(homedir()))
    );
  }

  getAgentsDir(): string {
    return path.join(this.targetDir, AGENTS_DIR_NAME);
  }

  getProjectTempDir(): string {
    const identifier = this.getProjectIdentifier();
    const tempDir = Storage.getGlobalTempDir();
    return path.join(tempDir, identifier);
  }

  getProjectDataDir(): string {
    const identifier = this.getProjectIdentifier();
    const dataDir = Storage.getGlobalDataDir();
    return path.join(dataDir, identifier);
  }

  getWorkspacePoliciesDir(): string {
    return path.join(this.getGeminiDir(), 'policies');
  }

  getWorkspaceAutoSavedPolicyPath(): string {
    return path.join(
      this.getWorkspacePoliciesDir(),
      AUTO_SAVED_POLICY_FILENAME,
    );
  }

  getAutoSavedPolicyPath(): string {
    return path.join(Storage.getUserPoliciesDir(), AUTO_SAVED_POLICY_FILENAME);
  }

  ensureProjectTempDirExists(): void {
    fs.mkdirSync(this.getProjectTempDir(), { recursive: true });
  }

  static getOAuthCredsPath(): string {
    return path.join(Storage.getGlobalGeminiDir(), OAUTH_FILE);
  }

  getProjectRoot(): string {
    return this.targetDir;
  }

  private getProjectIdentifier(): string {
    if (!this.projectIdentifier) {
      throw new Error('Storage must be initialized before use');
    }
    return this.projectIdentifier;
  }

  /**
   * Initializes storage by setting up the project registry.
   */
  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      if (this.projectIdentifier) {
        return;
      }

      const registryPath = path.join(
        Storage.getGlobalGeminiDir(),
        'projects.json',
      );
      const registry = new ProjectRegistry(registryPath, [
        Storage.getGlobalTempDir(),
        Storage.getGlobalDataDir(),
      ]);
      await registry.initialize();

      this.projectIdentifier = await registry.getShortId(this.getProjectRoot());
    })();

    return this.initPromise;
  }

  getHistoryDir(): string {
    return path.join(this.getProjectDataDir(), 'history');
  }

  getProjectMemoryDir(): string {
    return path.join(this.getProjectDataDir(), 'memory');
  }

  getProjectSkillsMemoryDir(): string {
    return path.join(this.getProjectMemoryDir(), 'skills');
  }

  getWorkspaceSettingsPath(): string {
    return path.join(this.getGeminiDir(), 'settings.json');
  }

  getProjectCommandsDir(): string {
    return path.join(this.getGeminiDir(), 'commands');
  }

  getProjectSkillsDir(): string {
    return path.join(this.getGeminiDir(), 'skills');
  }

  getProjectAgentSkillsDir(): string {
    return path.join(this.getAgentsDir(), 'skills');
  }

  getProjectAgentsDir(): string {
    return path.join(this.getGeminiDir(), 'agents');
  }

  getProjectCheckpointsDir(): string {
    return path.join(this.getProjectDataDir(), 'checkpoints');
  }

  getProjectLogsDir(): string {
    return path.join(this.getProjectDataDir(), 'logs');
  }

  getProjectPlansDir(): string {
    if (this.sessionId) {
      return path.join(this.getProjectDataDir(), this.sessionId, 'plans');
    }
    return path.join(this.getProjectDataDir(), 'plans');
  }

  getProjectTrackerDir(): string {
    if (this.sessionId) {
      return path.join(this.getProjectDataDir(), this.sessionId, 'tracker');
    }
    return path.join(this.getProjectDataDir(), 'tracker');
  }

  getPlansDir(): string {
    if (this.customPlansDir) {
      const resolvedPath = path.resolve(
        this.getProjectRoot(),
        this.customPlansDir,
      );
      const realProjectRoot = resolveToRealPath(this.getProjectRoot());
      const realResolvedPath = resolveToRealPath(resolvedPath);

      if (!isSubpath(realProjectRoot, realResolvedPath)) {
        throw new Error(
          `Custom plans directory '${this.customPlansDir}' resolves to '${realResolvedPath}', which is outside the project root '${realProjectRoot}'.`,
        );
      }

      return resolvedPath;
    }
    return this.getProjectPlansDir();
  }

  getProjectTasksDir(): string {
    if (this.sessionId) {
      return path.join(this.getProjectDataDir(), this.sessionId, 'tasks');
    }
    return path.join(this.getProjectDataDir(), 'tasks');
  }

  async listProjectChatFiles(): Promise<
    Array<{ filePath: string; lastUpdated: string }>
  > {
    const chatsDir = path.join(this.getProjectDataDir(), 'chats');
    try {
      const files = await fs.promises.readdir(chatsDir);
      const jsonFiles = files.filter(
        (f) => f.endsWith('.json') || f.endsWith('.jsonl'),
      );

      const sessions = await Promise.all(
        jsonFiles.map(async (file) => {
          const absolutePath = path.join(chatsDir, file);
          const stats = await fs.promises.stat(absolutePath);
          return {
            filePath: path.join('chats', file),
            lastUpdated: stats.mtime.toISOString(),
            mtimeMs: stats.mtimeMs,
          };
        }),
      );

      return sessions
        .sort((a, b) => b.mtimeMs - a.mtimeMs)
        .map(({ filePath, lastUpdated }) => ({ filePath, lastUpdated }));
    } catch (e) {
      // If directory doesn't exist, return empty
      if (
        e instanceof Error &&
        'code' in e &&
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        (e as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return [];
      }
      throw e;
    }
  }

  getExtensionsDir(): string {
    return path.join(this.getGeminiDir(), 'extensions');
  }

  getExtensionsConfigPath(): string {
    return path.join(this.getExtensionsDir(), 'sparkle-extension.json');
  }

  getHistoryFilePath(): string {
    return path.join(this.getProjectDataDir(), 'shell_history');
  }
}
