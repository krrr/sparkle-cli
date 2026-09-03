/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, it, expect, vi, afterEach } from 'vitest';

vi.unmock('./storage.js');
vi.unmock('./projectRegistry.js');

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    realpathSync: vi.fn(actual.realpathSync),
  };
});

import { Storage } from './storage.js';
import { SPARKLE_DIR, homedir, resolveToRealPath } from '../utils/paths.js';
import { ProjectRegistry } from './projectRegistry.js';

const PROJECT_SLUG = 'project-slug';

vi.mock('./projectRegistry.js');

describe('Storage – initialize', () => {
  const projectRoot = '/tmp/project';
  let storage: Storage;

  beforeEach(() => {
    ProjectRegistry.prototype.initialize = vi.fn().mockResolvedValue(undefined);
    ProjectRegistry.prototype.getShortId = vi
      .fn()
      .mockReturnValue(PROJECT_SLUG);
    storage = new Storage(projectRoot);
    vi.clearAllMocks();
  });

  it('sets up the registry when `getProjectTempDir` is called', async () => {
    await storage.initialize();
    expect(storage.getProjectTempDir()).toBe(
      path.join(os.homedir(), SPARKLE_DIR, 'tmp', PROJECT_SLUG),
    );

    // Verify registry initialization
    expect(ProjectRegistry).toHaveBeenCalled();
    expect(vi.mocked(ProjectRegistry).prototype.initialize).toHaveBeenCalled();
    expect(
      vi.mocked(ProjectRegistry).prototype.getShortId,
    ).toHaveBeenCalledWith(projectRoot);

    // Verify identifier is set by checking a path
    expect(storage.getProjectTempDir()).toContain(PROJECT_SLUG);
  });
});

vi.mock('../utils/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/paths.js')>();
  return {
    ...actual,
    homedir: vi.fn(actual.homedir),
  };
});

describe('Storage – getGlobalSettingsPath', () => {
  it('returns path to ~/.sparkle/settings.json', () => {
    const expected = path.join(os.homedir(), SPARKLE_DIR, 'settings.json');
    expect(Storage.getGlobalSettingsPath()).toBe(expected);
  });
});

describe('Storage - Security', () => {
  it('falls back to tmp for gemini but returns empty for agents if the home directory cannot be determined', () => {
    vi.mocked(homedir).mockReturnValue('');

    // .sparkle falls back for backward compatibility
    expect(Storage.getGlobalGeminiDir()).toBe(
      path.join(os.tmpdir(), SPARKLE_DIR),
    );

    // .agents returns empty to avoid insecure fallback WITHOUT throwing error
    expect(Storage.getGlobalAgentsDir()).toBe('');

    vi.mocked(homedir).mockReturnValue(os.homedir());
  });
});

describe('Storage – additional helpers', () => {
  const projectRoot = resolveToRealPath(path.resolve('/tmp/project'));
  const storage = new Storage(projectRoot);

  beforeEach(() => {
    ProjectRegistry.prototype.getShortId = vi
      .fn()
      .mockReturnValue(PROJECT_SLUG);
  });

  it('getWorkspaceSettingsPath returns project/.sparkle/settings.json', () => {
    const expected = path.join(projectRoot, SPARKLE_DIR, 'settings.json');
    expect(storage.getWorkspaceSettingsPath()).toBe(expected);
  });

  it('getUserCommandsDir returns ~/.sparkle/commands', () => {
    const expected = path.join(os.homedir(), SPARKLE_DIR, 'commands');
    expect(Storage.getUserCommandsDir()).toBe(expected);
  });

  it('getProjectCommandsDir returns project/.sparkle/commands', () => {
    const expected = path.join(projectRoot, SPARKLE_DIR, 'commands');
    expect(storage.getProjectCommandsDir()).toBe(expected);
  });

  it('getUserSkillsDir returns ~/.sparkle/skills', () => {
    const expected = path.join(os.homedir(), SPARKLE_DIR, 'skills');
    expect(Storage.getUserSkillsDir()).toBe(expected);
  });

  it('getProjectSkillsDir returns project/.sparkle/skills', () => {
    const expected = path.join(projectRoot, SPARKLE_DIR, 'skills');
    expect(storage.getProjectSkillsDir()).toBe(expected);
  });

  it('getUserAgentsDir returns ~/.sparkle/agents', () => {
    const expected = path.join(os.homedir(), SPARKLE_DIR, 'agents');
    expect(Storage.getUserAgentsDir()).toBe(expected);
  });

  it('getProjectAgentsDir returns project/.sparkle/agents', () => {
    const expected = path.join(projectRoot, SPARKLE_DIR, 'agents');
    expect(storage.getProjectAgentsDir()).toBe(expected);
  });

  it('getProjectMemoryDir returns ~/.sparkle/data/<identifier>/memory', async () => {
    await storage.initialize();
    const expected = path.join(
      os.homedir(),
      SPARKLE_DIR,
      'data',
      PROJECT_SLUG,
      'memory',
    );
    expect(storage.getProjectMemoryDir()).toBe(expected);
  });

  it('getMcpOAuthTokensPath returns ~/.sparkle/mcp-oauth-tokens.json', () => {
    const expected = path.join(
      os.homedir(),
      SPARKLE_DIR,
      'mcp-oauth-tokens.json',
    );
    expect(Storage.getMcpOAuthTokensPath()).toBe(expected);
  });

  it('getGlobalBinDir returns ~/.sparkle/tmp/bin', () => {
    const expected = path.join(os.homedir(), SPARKLE_DIR, 'tmp', 'bin');
    expect(Storage.getGlobalBinDir()).toBe(expected);
  });

  it('getProjectPlansDir returns ~/.sparkle/data/<identifier>/plans when no sessionId is provided', async () => {
    await storage.initialize();
    const dataDir = storage.getProjectDataDir();
    const expected = path.join(dataDir, 'plans');
    expect(storage.getProjectPlansDir()).toBe(expected);
  });

  it('getProjectPlansDir returns ~/.sparkle/data/<identifier>/<sessionId>/plans when sessionId is provided', async () => {
    const sessionId = 'test-session-id';
    const storageWithSession = new Storage(projectRoot, sessionId);
    ProjectRegistry.prototype.getShortId = vi
      .fn()
      .mockReturnValue(PROJECT_SLUG);
    await storageWithSession.initialize();
    const dataDir = storageWithSession.getProjectDataDir();
    const expected = path.join(dataDir, sessionId, 'plans');
    expect(storageWithSession.getProjectPlansDir()).toBe(expected);
  });

  it('getProjectTrackerDir returns ~/.sparkle/data/<identifier>/tracker when no sessionId is provided', async () => {
    await storage.initialize();
    const dataDir = storage.getProjectDataDir();
    const expected = path.join(dataDir, 'tracker');
    expect(storage.getProjectTrackerDir()).toBe(expected);
  });

  it('getProjectTrackerDir returns ~/.sparkle/data/<identifier>/<sessionId>/tracker when sessionId is provided', async () => {
    const sessionId = 'test-session-id';
    const storageWithSession = new Storage(projectRoot, sessionId);
    ProjectRegistry.prototype.getShortId = vi
      .fn()
      .mockReturnValue(PROJECT_SLUG);
    await storageWithSession.initialize();
    const dataDir = storageWithSession.getProjectDataDir();
    const expected = path.join(dataDir, sessionId, 'tracker');
    expect(storageWithSession.getProjectTrackerDir()).toBe(expected);
  });

  it('updates session-scoped directories when the sessionId changes', async () => {
    const storageWithSession = new Storage(projectRoot, 'session-one');
    ProjectRegistry.prototype.getShortId = vi
      .fn()
      .mockReturnValue(PROJECT_SLUG);
    await storageWithSession.initialize();
    const dataDir = storageWithSession.getProjectDataDir();

    storageWithSession.setSessionId('session-two');

    expect(storageWithSession.getProjectPlansDir()).toBe(
      path.join(dataDir, 'session-two', 'plans'),
    );
    expect(storageWithSession.getProjectTrackerDir()).toBe(
      path.join(dataDir, 'session-two', 'tracker'),
    );
    expect(storageWithSession.getProjectTasksDir()).toBe(
      path.join(dataDir, 'session-two', 'tasks'),
    );
  });

  describe('Session and JSON Loading', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('listProjectChatFiles returns sorted sessions from chats directory', async () => {
      const readdirSpy = vi
        .spyOn(fs.promises, 'readdir')
        /* eslint-disable @typescript-eslint/no-explicit-any */
        .mockResolvedValue([
          'session-1.json',
          'session-2.json',
          'not-a-session.txt',
        ] as any);

      const statSpy = vi
        .spyOn(fs.promises, 'stat')
        .mockImplementation(async (p: any) => {
          if (p.toString().endsWith('session-1.json')) {
            return {
              mtime: new Date('2026-02-01'),
              mtimeMs: 1000,
            } as any;
          }
          return {
            mtime: new Date('2026-02-02'),
            mtimeMs: 2000,
          } as any;
        });
      /* eslint-enable @typescript-eslint/no-explicit-any */

      const sessions = await storage.listProjectChatFiles();

      expect(readdirSpy).toHaveBeenCalledWith(expect.stringContaining('chats'));
      expect(sessions).toHaveLength(2);
      // Sorted by mtime desc
      expect(sessions[0].filePath).toBe(path.join('chats', 'session-2.json'));
      expect(sessions[1].filePath).toBe(path.join('chats', 'session-1.json'));
      expect(sessions[0].lastUpdated).toBe(
        new Date('2026-02-02').toISOString(),
      );

      readdirSpy.mockRestore();
      statSpy.mockRestore();
    });
  });

  describe('getPlansDir', () => {
    interface TestCase {
      name: string;
      customDir: string | undefined;
      expected: string | (() => string);
      expectedError?: string;
      setup?: () => () => void;
    }

    const testCases: TestCase[] = [
      {
        name: 'custom relative path',
        customDir: '.my-plans',
        expected: path.resolve(projectRoot, '.my-plans'),
      },
      {
        name: 'custom absolute path outside throws',
        customDir: path.resolve('/absolute/path/to/plans'),
        expected: '',
        expectedError: `Custom plans directory '${path.resolve('/absolute/path/to/plans')}' resolves to '${path.resolve('/absolute/path/to/plans')}', which is outside the project root '${resolveToRealPath(projectRoot)}'.`,
      },
      {
        name: 'absolute path that happens to be inside project root',
        customDir: path.join(projectRoot, 'internal-plans'),
        expected: path.join(projectRoot, 'internal-plans'),
      },
      {
        name: 'relative path that stays within project root',
        customDir: 'subdir/../plans',
        expected: path.resolve(projectRoot, 'plans'),
      },
      {
        name: 'dot path',
        customDir: '.',
        expected: projectRoot,
      },
      {
        name: 'default behavior when customDir is undefined',
        customDir: undefined,
        expected: () => storage.getProjectPlansDir(),
      },
      {
        name: 'escaping relative path throws',
        customDir: '../escaped-plans',
        expected: '',
        expectedError: `Custom plans directory '../escaped-plans' resolves to '${resolveToRealPath(path.resolve(projectRoot, '../escaped-plans'))}', which is outside the project root '${resolveToRealPath(projectRoot)}'.`,
      },
      {
        name: 'hidden directory starting with ..',
        customDir: '..plans',
        expected: path.resolve(projectRoot, '..plans'),
      },
      {
        name: 'security escape via symbolic link throws',
        customDir: 'symlink-to-outside',
        setup: () => {
          vi.mocked(fs.realpathSync).mockImplementation((p: fs.PathLike) => {
            if (p.toString().includes('symlink-to-outside')) {
              return path.resolve('/outside/project/root');
            }
            return p.toString();
          });
          return () => vi.mocked(fs.realpathSync).mockRestore();
        },
        expected: '',
        expectedError: `Custom plans directory 'symlink-to-outside' resolves to '${path.resolve('/outside/project/root')}', which is outside the project root '${resolveToRealPath(projectRoot)}'.`,
      },
    ];

    testCases.forEach(({ name, customDir, expected, expectedError, setup }) => {
      it(`should handle ${name}`, async () => {
        const cleanup = setup?.();
        try {
          if (name.includes('default behavior')) {
            await storage.initialize();
          }

          storage.setCustomPlansDir(customDir);
          if (expectedError) {
            expect(() => storage.getPlansDir()).toThrow(expectedError);
          } else {
            const expectedValue =
              typeof expected === 'function' ? expected() : expected;
            expect(storage.getPlansDir()).toBe(expectedValue);
          }
        } finally {
          cleanup?.();
        }
      });
    });
  });
});

describe('Storage - System Paths', () => {
  const originalEnv = process.env['SPARKLE_CLI_SYSTEM_SETTINGS_PATH'];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['SPARKLE_CLI_SYSTEM_SETTINGS_PATH'] = originalEnv;
    } else {
      delete process.env['SPARKLE_CLI_SYSTEM_SETTINGS_PATH'];
    }
  });

  it('getSystemSettingsPath returns correct path based on platform (default)', () => {
    delete process.env['SPARKLE_CLI_SYSTEM_SETTINGS_PATH'];

    const platform = os.platform();
    const result = Storage.getSystemSettingsPath();

    if (platform === 'darwin') {
      expect(result).toBe(
        '/Library/Application Support/GeminiCli/settings.json',
      );
    } else if (platform === 'win32') {
      expect(result).toBe('C:\\ProgramData\\sparkle-cli\\settings.json');
    } else {
      expect(result).toBe('/etc/sparkle-cli/settings.json');
    }
  });

  it('getSystemSettingsPath follows SPARKLE_CLI_SYSTEM_SETTINGS_PATH if set', () => {
    const customPath = '/custom/path/settings.json';
    process.env['SPARKLE_CLI_SYSTEM_SETTINGS_PATH'] = customPath;
    expect(Storage.getSystemSettingsPath()).toBe(customPath);
  });
});
