/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:os BEFORE importing coreTools to ensure it uses the mock
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    platform: () => 'linux',
  };
});

import {
  READ_FILE_DECLARATION,
  WRITE_FILE_DECLARATION,
  GREP_DECLARATION,
  RIP_GREP_DECLARATION,
  GLOB_DECLARATION,
  LS_DECLARATION,
  EDIT_DECLARATION,
  WEB_SEARCH_DECLARATION,
  WEB_FETCH_DECLARATION,
  READ_MANY_FILES_DECLARATION,
  WRITE_TODOS_DECLARATION,
  GET_INTERNAL_DOCS_DECLARATION,
  ASK_USER_DECLARATION,
  ENTER_PLAN_MODE_DECLARATION,
  READ_MCP_RESOURCE_DECLARATION,
  LIST_MCP_RESOURCES_DECLARATION,
} from './coreTools.js';
import {
  getShellDeclaration,
  getExitPlanModeDeclaration,
  getActivateSkillDeclaration,
} from './dynamic-declaration-helpers.js';

describe('core tool declaration snapshots', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Stub process.platform to 'linux' by default for deterministic snapshots across OSes
    vi.stubGlobal(
      'process',
      Object.create(process, {
        platform: {
          get: () => 'linux',
        },
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const tools = [
    { name: 'read_file', declaration: READ_FILE_DECLARATION },
    { name: 'write_file', declaration: WRITE_FILE_DECLARATION },
    { name: 'grep_search', declaration: GREP_DECLARATION },
    { name: 'grep_search_ripgrep', declaration: RIP_GREP_DECLARATION },
    { name: 'glob', declaration: GLOB_DECLARATION },
    { name: 'list_directory', declaration: LS_DECLARATION },
    {
      name: 'run_shell_command',
      declaration: getShellDeclaration(true, true, true),
    },
    { name: 'replace', declaration: EDIT_DECLARATION },
    { name: 'web_search', declaration: WEB_SEARCH_DECLARATION },
    { name: 'web_fetch', declaration: WEB_FETCH_DECLARATION },
    { name: 'read_many_files', declaration: READ_MANY_FILES_DECLARATION },
    { name: 'write_todos', declaration: WRITE_TODOS_DECLARATION },
    { name: 'get_internal_docs', declaration: GET_INTERNAL_DOCS_DECLARATION },
    { name: 'ask_user', declaration: ASK_USER_DECLARATION },
    { name: 'enter_plan_mode', declaration: ENTER_PLAN_MODE_DECLARATION },
    { name: 'exit_plan_mode', declaration: getExitPlanModeDeclaration() },
    {
      name: 'activate_skill',
      declaration: getActivateSkillDeclaration(['skill1', 'skill2']),
    },
    {
      name: 'activate_skill_empty',
      declaration: getActivateSkillDeclaration([]),
    },
    {
      name: 'activate_skill_single',
      declaration: getActivateSkillDeclaration(['skill1']),
    },
    { name: 'read_mcp_resource', declaration: READ_MCP_RESOURCE_DECLARATION },
    {
      name: 'list_mcp_resources',
      declaration: LIST_MCP_RESOURCES_DECLARATION,
    },
  ];

  for (const tool of tools) {
    it(`snapshot for tool: ${tool.name}`, () => {
      expect(tool.declaration).toMatchSnapshot();
    });
  }
});
