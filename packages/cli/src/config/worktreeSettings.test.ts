/**
 * @license
 * Copyright 2026 krrr
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadCliConfig, parseArguments } from './config.js';
import { createTestMergedSettings } from './settings.js';
import { execa } from 'execa';

vi.mock('execa');

describe('loadCliConfig worktreeSettings optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use provided worktreeSettings and skip git calls', async () => {
    const mockWt = {
      name: 'wt-branch',
      path: '/test/wt',
      baseSha: 'abc1234',
    };
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments(createTestMergedSettings());
    const config = await loadCliConfig(
      createTestMergedSettings(),
      'test-session',
      argv,
      { worktreeSettings: mockWt },
    );

    expect(config.getWorktreeSettings()).toEqual(mockWt);
    expect(execa).not.toHaveBeenCalled();
  });

  it('should treat explicit worktreeSettings: undefined as provided and skip git calls', async () => {
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments(createTestMergedSettings());
    const config = await loadCliConfig(
      createTestMergedSettings(),
      'test-session',
      argv,
      { worktreeSettings: undefined },
    );

    expect(config.getWorktreeSettings()).toBeUndefined();
    expect(execa).not.toHaveBeenCalled();
  });

  it('should call execa with combined rev-parse flags and timeout when worktreeSettings is omitted', async () => {
    vi.mocked(execa).mockRejectedValueOnce(new Error('not a git repo'));
    process.argv = ['node', 'script.js'];
    const argv = await parseArguments(createTestMergedSettings());
    const config = await loadCliConfig(
      createTestMergedSettings(),
      'test-session',
      argv,
    );

    expect(config.getWorktreeSettings()).toBeUndefined();
    expect(execa).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--show-toplevel', '--git-common-dir'],
      expect.objectContaining({ timeout: 10000 }),
    );
  });

  it('should resolve worktree if cwd is a valid Sparkle worktree', async () => {
    const tmpProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-test-'));
    const tmpWorktreePath = path.join(
      tmpProjectRoot,
      '.sparkle',
      'worktrees',
      'feat-1',
    );
    fs.mkdirSync(tmpWorktreePath, { recursive: true });

    try {
      vi.mocked(execa).mockImplementation(((cmd: string, args: string[]) => {
        if (args.includes('--show-toplevel')) {
          return Promise.resolve({
            stdout: `${tmpWorktreePath}\n${path.join(tmpProjectRoot, '.git')}`,
          });
        }
        if (args.includes('HEAD')) {
          return Promise.resolve({
            stdout: 'commit-sha-12345',
          });
        }
        return Promise.reject(new Error('unknown command'));
      }) as unknown as typeof execa);

      process.argv = ['node', 'script.js'];
      const argv = await parseArguments(createTestMergedSettings());
      const config = await loadCliConfig(
        createTestMergedSettings(),
        'test-session',
        argv,
        { cwd: tmpWorktreePath },
      );

      const wt = config.getWorktreeSettings();
      expect(wt).toBeDefined();
      expect(wt?.name).toBe('feat-1');
      expect(wt?.path).toBe(tmpWorktreePath);
      expect(wt?.baseSha).toBe('commit-sha-12345');
    } finally {
      fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
    }
  });
});
