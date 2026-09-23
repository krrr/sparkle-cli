/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import type { PartListUnion, PartUnion } from '@google/genai';
import type { AnyToolInvocation, Config } from 'sparkle-cli-core';
import {
  debugLogger,
  getErrorMessage,
  unescapePath,
  resolveToRealPath,
  fileExists,
  ReadManyFilesTool,
  LSTool,
  REFERENCE_CONTENT_START,
  REFERENCE_CONTENT_END,
  CoreToolCallStatus,
  resolveAtCommandPath,
} from 'sparkle-cli-core';
import { Buffer } from 'node:buffer';
import type {
  HistoryItemToolGroup,
  IndividualToolCallDisplay,
} from '../types.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';

const REF_CONTENT_HEADER = `\n${REFERENCE_CONTENT_START}`;
const REF_CONTENT_FOOTER = `\n${REFERENCE_CONTENT_END}`;

/**
 * Escapes unescaped @ symbols so they are not interpreted as @path commands.
 */
export function escapeAtSymbols(text: string): string {
  return text.replace(/(?<!\\)@/g, '\\@');
}

/**
 * Unescapes \@ back to @ correctly, preserving \\@ sequences.
 */
export function unescapeLiteralAt(text: string): string {
  return text.replace(/\\@/g, (match, offset, full) => {
    let backslashCount = 0;
    for (let i = offset - 1; i >= 0 && full[i] === '\\'; i--) {
      backslashCount++;
    }
    return backslashCount % 2 === 0 ? '@' : '\\@';
  });
}

/**
 * Regex source for the path/command part of an @ reference.
 * It uses strict ASCII whitespace delimiters to allow Unicode characters like NNBSP in filenames.
 *
 * 1. "(?:[^"]*)" matches a double-quoted string (for Windows paths with spaces).
 * 2. \\. matches any escaped character (e.g., \ ).
 * 3. [^ \t\n\r,;!?()\[\]{}.] matches any character that is NOT a delimiter and NOT a period.
 * 4. \.(?!$|[ \t\n\r]) matches a period ONLY if it is NOT followed by whitespace or end-of-string.
 */
export const AT_COMMAND_PATH_REGEX_SOURCE =
  '(?:(?:"(?:[^"]*)")|(?:\\\\.|[^ \\t\\n\\r,;!?()\\[\\]{}.]|\\.(?!$|[ \\t\\n\\r])))+';

interface HandleAtCommandParams {
  query: string;
  config: Config;
  addItem: UseHistoryManagerReturn['addItem'];
  onDebugMessage: (message: string) => void;
  messageId: number;
  signal: AbortSignal;
  escapePastedAtSymbols?: boolean;
}

interface HandleAtCommandResult {
  processedQuery: PartListUnion | null;
  error?: string;
}

interface AtCommandPart {
  type: 'text' | 'atPath';
  content: string;
}

/**
 * Parses a query string to find all '@<path>' commands and text segments.
 * Handles \ escaped spaces within paths.
 */
function parseAllAtCommands(
  query: string,
  escapePastedAtSymbols = false,
): AtCommandPart[] {
  const parts: AtCommandPart[] = [];
  let lastIndex = 0;

  // Create a new RegExp instance for each call to avoid shared state/lastIndex issues.
  const atCommandRegex = new RegExp(
    `(?<!\\\\)@${AT_COMMAND_PATH_REGEX_SOURCE}`,
    'g',
  );

  let match: RegExpExecArray | null;

  while ((match = atCommandRegex.exec(query)) !== null) {
    const matchIndex = match.index;
    const fullMatch = match[0];

    // Add text before @
    if (matchIndex > lastIndex) {
      parts.push({
        type: 'text',
        content: escapePastedAtSymbols
          ? unescapeLiteralAt(query.substring(lastIndex, matchIndex))
          : query.substring(lastIndex, matchIndex),
      });
    }

    // We strip the @ before unescaping so that unescapePath can handle quoted paths correctly on Windows.
    const atPath = '@' + unescapePath(fullMatch.substring(1));
    parts.push({ type: 'atPath', content: atPath });

    lastIndex = matchIndex + fullMatch.length;
  }

  // Add remaining text
  if (lastIndex < query.length) {
    parts.push({
      type: 'text',
      content: escapePastedAtSymbols
        ? unescapeLiteralAt(query.substring(lastIndex))
        : query.substring(lastIndex),
    });
  }

  // Filter out empty text parts that might result from consecutive @paths or leading/trailing spaces
  return parts.filter(
    (part) => !(part.type === 'text' && part.content.trim() === ''),
  );
}

function categorizeAtCommands(
  commandParts: AtCommandPart[],
  config: Config,
): {
  agentParts: AtCommandPart[];
  resourceParts: AtCommandPart[];
  fileParts: AtCommandPart[];
} {
  const agentParts: AtCommandPart[] = [];
  const resourceParts: AtCommandPart[] = [];
  const fileParts: AtCommandPart[] = [];

  const agentRegistry = config.getAgentRegistry?.();
  const resourceRegistry = config.getResourceRegistry();

  for (const part of commandParts) {
    if (part.type !== 'atPath' || part.content === '@') {
      continue;
    }

    const name = part.content.substring(1);

    if (agentRegistry?.getDefinition(name)) {
      agentParts.push(part);
    } else if (resourceRegistry.findResourceByUri(name)) {
      resourceParts.push(part);
    } else {
      fileParts.push(part);
    }
  }

  return { agentParts, resourceParts, fileParts };
}

/**
 * Checks if the query contains any file paths that require read permission.
 * Returns an array of such paths.
 */
export async function checkPermissions(
  query: string,
  config: Config,
): Promise<string[]> {
  const commandParts = parseAllAtCommands(query);
  const { fileParts } = categorizeAtCommands(commandParts, config);
  const permissionsRequired: string[] = [];

  for (const part of fileParts) {
    const pathName = part.content.substring(1);
    if (!pathName) continue;

    let resolvedPathName: string;
    try {
      resolvedPathName = resolveToRealPath(
        path.resolve(config.getTargetDir(), pathName),
      );
    } catch {
      // skip if resolveToRealPath errors out
      continue;
    }

    if (config.validatePathAccess(resolvedPathName, 'read')) {
      if (await fileExists(resolvedPathName)) {
        permissionsRequired.push(resolvedPathName);
      }
    }
  }
  return permissionsRequired;
}

interface ResolvedFile {
  part: AtCommandPart;
  pathSpec: string;
  displayLabel: string;
  absolutePath?: string;
  isDirectory?: boolean;
}

interface IgnoredFile {
  path: string;
  reason: 'git' | 'sparkle' | 'both';
}

/**
 * Resolves file paths from @ commands, handling globs, recursion, and ignores.
 */
async function resolveFilePaths(
  fileParts: AtCommandPart[],
  config: Config,
  onDebugMessage: (message: string) => void,
  signal: AbortSignal,
): Promise<{ resolvedFiles: ResolvedFile[]; ignoredFiles: IgnoredFile[] }> {
  const fileDiscovery = config.getFileService();
  const respectFileIgnore = config.getFileFilteringOptions();
  const toolRegistry = config.getToolRegistry();
  const globTool = toolRegistry.getTool('glob');

  const resolvedFiles: ResolvedFile[] = [];
  const ignoredFiles: IgnoredFile[] = [];

  for (const part of fileParts) {
    const originalAtPath = part.content;
    const pathName = originalAtPath.substring(1);

    if (!pathName) {
      continue;
    }

    const gitIgnored =
      respectFileIgnore.respectGitIgnore &&
      fileDiscovery.shouldIgnoreFile(pathName, {
        respectGitIgnore: true,
        respectSparkleIgnore: false,
      });
    const sparkleIgnored =
      respectFileIgnore.respectSparkleIgnore &&
      fileDiscovery.shouldIgnoreFile(pathName, {
        respectGitIgnore: false,
        respectSparkleIgnore: true,
      });

    if (gitIgnored || sparkleIgnored) {
      const reason =
        gitIgnored && sparkleIgnored ? 'both' : gitIgnored ? 'git' : 'sparkle';
      ignoredFiles.push({ path: pathName, reason });
      const reasonText =
        reason === 'both'
          ? 'ignored by both git and sparkle'
          : reason === 'git'
            ? 'git-ignored'
            : 'sparkle-ignored';
      onDebugMessage(`Path ${pathName} is ${reasonText} and will be skipped.`);
      continue;
    }

    const result = await resolveAtCommandPath(pathName, config, onDebugMessage);

    if (result.status === 'resolved') {
      const { absolutePath, relativePath, stats } = result.resolved;
      if (stats.isDirectory()) {
        resolvedFiles.push({
          part,
          pathSpec: relativePath,
          displayLabel: path.isAbsolute(pathName) ? relativePath : pathName,
          absolutePath,
          isDirectory: true,
        });
        onDebugMessage(`Path ${pathName} resolved to directory.`);
      } else {
        resolvedFiles.push({
          part,
          pathSpec: relativePath,
          displayLabel: path.isAbsolute(pathName) ? relativePath : pathName,
          absolutePath,
        });
        onDebugMessage(
          `Path ${pathName} resolved to file: ${absolutePath}, using relative path: ${relativePath}`,
        );
      }
    } else if (
      result.status === 'not_found' ||
      result.status === 'unauthorized'
    ) {
      // If direct resolution fails, we attempt glob search if enabled.
      // We also allow glob fallback for "unauthorized" results from resolveAtCommandPath,
      // as they might represent a relative path that matched an unauthorized file in one directory
      // but might have a valid match (via glob) in another.
      if (config.getEnableRecursiveFileSearch() && globTool) {
        onDebugMessage(
          `Path ${pathName} not found directly, attempting glob search.`,
        );

        for (const dir of config.getWorkspaceContext().getDirectories()) {
          try {
            const globResult = await globTool.buildAndExecute(
              {
                pattern: `**/*${pathName}*`,
                path: dir,
              },
              signal,
            );
            if (
              globResult.llmContent &&
              typeof globResult.llmContent === 'string' &&
              !globResult.llmContent.startsWith('No files found') &&
              !globResult.llmContent.startsWith('Error:')
            ) {
              const lines = globResult.llmContent.split('\n');
              if (lines.length > 1 && lines[1]) {
                const rawMatch = lines[1].trim();
                let firstMatchAbsolute: string;
                try {
                  firstMatchAbsolute = resolveToRealPath(rawMatch);
                } catch {
                  firstMatchAbsolute = rawMatch;
                }
                const pathSpec = path.relative(dir, firstMatchAbsolute);
                resolvedFiles.push({
                  part,
                  pathSpec,
                  displayLabel: path.isAbsolute(pathName) ? pathSpec : pathName,
                  absolutePath: firstMatchAbsolute,
                });
                onDebugMessage(
                  `Glob search for ${pathName} found ${firstMatchAbsolute}, using relative path: ${pathSpec}`,
                );
                break;
              } else {
                onDebugMessage(
                  `Glob search for '**/*${pathName}*' did not return a usable path. Path ${pathName} will be skipped.`,
                );
              }
            } else {
              onDebugMessage(
                `Glob search for '**/*${pathName}*' found no files or an error. Path ${pathName} will be skipped.`,
              );
            }
          } catch (globError) {
            debugLogger.warn(
              `Error during glob search for ${pathName}: ${getErrorMessage(globError)}`,
            );
          }
        }
      } else {
        if (!config.getEnableRecursiveFileSearch() || !globTool) {
          onDebugMessage(
            `Glob tool not found. Path ${pathName} will be skipped.`,
          );
        }
      }
    }
  }

  return { resolvedFiles, ignoredFiles };
}

/**
 * Rebuilds the user query, replacing @ commands with their resolved path specs or agent/resource names.
 */
function constructInitialQuery(
  commandParts: AtCommandPart[],
  resolvedFiles: ResolvedFile[],
): string {
  const replacementMap = new Map<AtCommandPart, string>();
  for (const rf of resolvedFiles) {
    replacementMap.set(rf.part, rf.pathSpec);
  }

  let result = '';
  for (let i = 0; i < commandParts.length; i++) {
    const part = commandParts[i];
    let content = part.content;

    if (part.type === 'atPath') {
      const resolved = replacementMap.get(part);
      content = resolved ? `@${resolved}` : part.content;

      if (i > 0 && result.length > 0 && !result.endsWith(' ')) {
        result += ' ';
      }
    }

    result += content;
  }
  return result.trim();
}

/**
 * Reads content from MCP resources.
 */
async function readMcpResources(
  resourceParts: AtCommandPart[],
  config: Config,
  signal: AbortSignal,
): Promise<{
  parts: PartUnion[];
  displays: IndividualToolCallDisplay[];
  error?: string;
}> {
  const resourceRegistry = config.getResourceRegistry();
  const mcpClientManager = config.getMcpClientManager();
  const parts: PartUnion[] = [];
  const displays: IndividualToolCallDisplay[] = [];

  const resourcePromises = resourceParts.map(async (part) => {
    const uri = part.content.substring(1);
    const resource = resourceRegistry.findResourceByUri(uri);
    if (!resource) {
      // Should not happen as it was categorized as a resource
      return { success: false, parts: [], uri };
    }

    const client = mcpClientManager?.getClient(resource.serverName);
    try {
      if (!client) {
        throw new Error(
          `MCP client for server '${resource.serverName}' is not available or not connected.`,
        );
      }
      const response = await client.readResource(resource.uri, { signal });
      const resourceParts = convertResourceContentsToParts(response);
      return {
        success: true,
        parts: resourceParts,
        uri: resource.uri,
        display: {
          callId: `mcp-resource-${resource.serverName}-${resource.uri}`,
          name: `resources/read (${resource.serverName})`,
          description: resource.uri,
          status: CoreToolCallStatus.Success,
          isClientInitiated: true,
          resultDisplay: `Successfully read resource ${resource.uri}`,
          confirmationDetails: undefined,
        } as IndividualToolCallDisplay,
      };
    } catch (error) {
      return {
        success: false,
        parts: [],
        uri: resource.uri,
        display: {
          callId: `mcp-resource-${resource.serverName}-${resource.uri}`,
          name: `resources/read (${resource.serverName})`,
          description: resource.uri,
          status: CoreToolCallStatus.Error,
          isClientInitiated: true,
          resultDisplay: `Error reading resource ${resource.uri}: ${getErrorMessage(error)}`,
          confirmationDetails: undefined,
        } as IndividualToolCallDisplay,
      };
    }
  });

  const resourceResults = await Promise.all(resourcePromises);
  let hasError = false;

  for (const result of resourceResults) {
    if (result.display) {
      displays.push(result.display);
    }
    if (result.success) {
      parts.push({ text: `\nContent from @${result.uri}:\n` });
      parts.push(...result.parts);
    } else {
      hasError = true;
    }
  }

  if (hasError) {
    const firstError = displays.find(
      (d) => d.status === CoreToolCallStatus.Error,
    );
    return {
      parts: [],
      displays,
      error: `Exiting due to an error processing the @ command: ${firstError?.resultDisplay}`,
    };
  }

  return { parts, displays };
}

/**
 * Reads content from local files using the ReadManyFilesTool.
 */
async function readLocalFiles(
  resolvedFiles: ResolvedFile[],
  config: Config,
  signal: AbortSignal,
  userMessageTimestamp: number,
): Promise<{
  parts: PartUnion[];
  displays: IndividualToolCallDisplay[];
  error?: string;
}> {
  const fileResolvedFiles = resolvedFiles.filter((rf) => !rf.isDirectory);
  if (fileResolvedFiles.length === 0) {
    return { parts: [], displays: [] };
  }

  const readManyFilesTool = new ReadManyFilesTool(
    config,
    config.getMessageBus(),
  );

  const pathSpecsToRead = fileResolvedFiles.map(
    (rf) => rf.absolutePath ?? rf.pathSpec,
  );
  const fileLabelsForDisplay = fileResolvedFiles.map((rf) => rf.displayLabel);
  const respectFileIgnore = config.getFileFilteringOptions();

  const toolArgs = {
    include: pathSpecsToRead,
    file_filtering_options: {
      respect_git_ignore: respectFileIgnore.respectGitIgnore,
      respect_sparkle_ignore: respectFileIgnore.respectSparkleIgnore,
    },
  };

  let invocation: AnyToolInvocation | undefined = undefined;
  try {
    invocation = readManyFilesTool.build(toolArgs);
    const result = await invocation.execute({ abortSignal: signal });
    const display: IndividualToolCallDisplay = {
      callId: `client-read-${userMessageTimestamp}`,
      name: readManyFilesTool.displayName,
      description: invocation.getDescription(),
      status: CoreToolCallStatus.Success,
      isClientInitiated: true,
      resultDisplay:
        result.returnDisplay ||
        `Successfully read: ${fileLabelsForDisplay.join(', ')}`,
      confirmationDetails: undefined,
    };

    const parts: PartUnion[] = [];
    if (Array.isArray(result.llmContent)) {
      const fileContentRegex = /^--- (.*?) ---\n\n([\s\S]*?)\n\n$/;
      for (const part of result.llmContent) {
        if (typeof part === 'string') {
          const match = fileContentRegex.exec(part);
          if (match) {
            const filePathSpecInContent = match[1];
            const fileActualContent = match[2].trim();

            // Find the display label for this path
            const resolvedFile = fileResolvedFiles.find(
              (rf) =>
                rf.absolutePath === filePathSpecInContent ||
                rf.pathSpec === filePathSpecInContent,
            );

            let displayPath = resolvedFile?.displayLabel;

            if (!displayPath) {
              // Fallback: if no mapping found, try to convert absolute path to relative
              for (const dir of config.getWorkspaceContext().getDirectories()) {
                if (filePathSpecInContent.startsWith(dir)) {
                  displayPath = path.relative(dir, filePathSpecInContent);
                  break;
                }
              }
            }

            displayPath = displayPath || filePathSpecInContent;

            parts.push({
              text: `\nContent from @${displayPath}:\n`,
            });
            parts.push({ text: fileActualContent });
          } else {
            parts.push({ text: part });
          }
        } else {
          parts.push(part);
        }
      }
    }

    return { parts, displays: [display] };
  } catch (error: unknown) {
    const errorDisplay: IndividualToolCallDisplay = {
      callId: `client-read-${userMessageTimestamp}`,
      name: readManyFilesTool.displayName,
      description:
        invocation?.getDescription() ??
        'Error attempting to execute tool to read files',
      status: CoreToolCallStatus.Error,
      isClientInitiated: true,
      resultDisplay: `Error reading files (${fileLabelsForDisplay.join(', ')}): ${getErrorMessage(error)}`,
      confirmationDetails: undefined,
    };
    return {
      parts: [],
      displays: [errorDisplay],
      error: `Exiting due to an error processing the @ command: ${errorDisplay.resultDisplay}`,
    };
  }
}

/**
 * Lists the structure of directories using the LSTool.
 */
async function readDirectories(
  resolvedFiles: ResolvedFile[],
  config: Config,
  signal: AbortSignal,
  userMessageTimestamp: number,
): Promise<{
  parts: PartUnion[];
  displays: IndividualToolCallDisplay[];
  error?: string;
}> {
  const directoryResolvedFiles = resolvedFiles.filter((rf) => rf.isDirectory);
  if (directoryResolvedFiles.length === 0) {
    return { parts: [], displays: [] };
  }

  const lsTool = new LSTool(config, config.getMessageBus());
  const respectFileIgnore = config.getFileFilteringOptions();

  const results = await Promise.all(
    directoryResolvedFiles.map(async (rf) => {
      const toolArgs = {
        dir_path: rf.absolutePath ?? rf.pathSpec,
        file_filtering_options: {
          respect_git_ignore: respectFileIgnore.respectGitIgnore,
          respect_sparkle_ignore: respectFileIgnore.respectSparkleIgnore,
        },
      };

      try {
        const invocation = lsTool.build(toolArgs);
        const result = await invocation.execute({ abortSignal: signal });
        const display: IndividualToolCallDisplay = {
          callId: `client-ls-${userMessageTimestamp}-${rf.displayLabel}`,
          name: lsTool.displayName,
          description: invocation.getDescription(),
          status: CoreToolCallStatus.Success,
          isClientInitiated: true,
          resultDisplay: result.returnDisplay,
          confirmationDetails: undefined,
        };

        const llmContent =
          typeof result.llmContent === 'string'
            ? result.llmContent
            : Array.isArray(result.llmContent)
              ? result.llmContent
                  .map((part) => (typeof part === 'string' ? part : ''))
                  .join('')
              : '';

        return {
          parts: [
            { text: `\nContent from @${rf.displayLabel}:\n` },
            { text: llmContent },
          ] as PartUnion[],
          display,
        };
      } catch (error: unknown) {
        const errorDisplay: IndividualToolCallDisplay = {
          callId: `client-ls-${userMessageTimestamp}-${rf.displayLabel}`,
          name: lsTool.displayName,
          description: `Error attempting to list directory ${rf.displayLabel}`,
          status: CoreToolCallStatus.Error,
          isClientInitiated: true,
          resultDisplay: `Error listing directory (${rf.displayLabel}): ${getErrorMessage(error)}`,
          confirmationDetails: undefined,
        };
        return {
          parts: [] as PartUnion[],
          display: errorDisplay,
          error: `Exiting due to an error processing the @ command: ${errorDisplay.resultDisplay}`,
        };
      }
    }),
  );

  const parts: PartUnion[] = [];
  const displays: IndividualToolCallDisplay[] = [];
  let firstError: string | undefined = undefined;
  for (const result of results) {
    parts.push(...result.parts);
    displays.push(result.display);
    if (!firstError && result.error) {
      firstError = result.error;
    }
  }

  return { parts, displays, error: firstError };
}

/**
 * Reports ignored files to the debug log and debug message callback.
 */
function reportIgnoredFiles(
  ignoredFiles: IgnoredFile[],
  onDebugMessage: (message: string) => void,
): void {
  const totalIgnored = ignoredFiles.length;
  if (totalIgnored === 0) {
    return;
  }

  const ignoredByReason: Record<string, string[]> = {
    git: [],
    sparkle: [],
    both: [],
  };

  for (const file of ignoredFiles) {
    ignoredByReason[file.reason].push(file.path);
  }

  const messages = [];
  if (ignoredByReason['git'].length) {
    messages.push(`Git-ignored: ${ignoredByReason['git'].join(', ')}`);
  }
  if (ignoredByReason['sparkle'].length) {
    messages.push(`Sparkle-ignored: ${ignoredByReason['sparkle'].join(', ')}`);
  }
  if (ignoredByReason['both'].length) {
    messages.push(`Ignored by both: ${ignoredByReason['both'].join(', ')}`);
  }

  const message = `Ignored ${totalIgnored} files:\n${messages.join('\n')}`;
  debugLogger.log(message);
  onDebugMessage(message);
}

/**
 * Processes user input containing one or more '@<path>' commands.
 * - Workspace file paths are read via the 'read_many_files' tool.
 * - Workspace directory paths are listed via the 'list_directory' tool.
 * - MCP resource URIs are read via each server's `resources/read`.
 * The user query is updated with inline content blocks so the LLM receives the
 * referenced context directly.
 *
 * @returns An object indicating whether the main hook should proceed with an
 *          LLM call and the processed query parts (including file/resource content).
 */
export async function handleAtCommand({
  query,
  config,
  addItem,
  onDebugMessage,
  messageId: userMessageTimestamp,
  signal,
  escapePastedAtSymbols = false,
}: HandleAtCommandParams): Promise<HandleAtCommandResult> {
  const commandParts = parseAllAtCommands(query, escapePastedAtSymbols);

  const { agentParts, resourceParts, fileParts } = categorizeAtCommands(
    commandParts,
    config,
  );

  const { resolvedFiles, ignoredFiles } = await resolveFilePaths(
    fileParts,
    config,
    onDebugMessage,
    signal,
  );

  reportIgnoredFiles(ignoredFiles, onDebugMessage);

  if (
    resolvedFiles.length === 0 &&
    resourceParts.length === 0 &&
    agentParts.length === 0
  ) {
    onDebugMessage(
      'No valid file paths, resources, or agents found in @ commands.',
    );
    return { processedQuery: [{ text: query }] };
  }

  const initialQueryText = constructInitialQuery(commandParts, resolvedFiles);

  const processedQueryParts: PartListUnion = [{ text: initialQueryText }];

  if (agentParts.length > 0) {
    const agentNames = agentParts.map((p) => p.content.substring(1));
    const toolsList = agentNames.map((agent) => `'${agent}'`).join(', ');
    const agentNudge = `\n<system_note>\nThe user has explicitly selected the following agent(s): ${agentNames.join(
      ', ',
    )}. Please use the following tool(s) to delegate the task: ${toolsList}.\n</system_note>\n`;
    processedQueryParts.push({ text: agentNudge });
  }

  const [mcpResult, fileResult, dirResult] = await Promise.all([
    readMcpResources(resourceParts, config, signal),
    readLocalFiles(resolvedFiles, config, signal, userMessageTimestamp),
    readDirectories(resolvedFiles, config, signal, userMessageTimestamp),
  ]);

  const hasContent =
    mcpResult.parts.length > 0 ||
    fileResult.parts.length > 0 ||
    dirResult.parts.length > 0;
  if (hasContent) {
    processedQueryParts.push({ text: REF_CONTENT_HEADER });
    processedQueryParts.push(...mcpResult.parts);
    // Directory listings must precede fileResult: ReadManyFilesTool appends
    // REFERENCE_CONTENT_END itself, so anything pushed after fileResult.parts
    // would fall outside the reference block.
    processedQueryParts.push(...dirResult.parts);
    processedQueryParts.push(...fileResult.parts);

    // ReadManyFilesTool appends REFERENCE_CONTENT_END itself when it produced
    // content. Only close the block here when it did not (e.g. directory
    // listings or MCP resources only).
    if (fileResult.parts.length === 0) {
      processedQueryParts.push({ text: REF_CONTENT_FOOTER });
    }
  }

  const allDisplays = [
    ...mcpResult.displays,
    ...fileResult.displays,
    ...dirResult.displays,
  ];

  if (allDisplays.length > 0) {
    addItem(
      {
        type: 'tool_group',
        tools: allDisplays,
      } as HistoryItemToolGroup,
      userMessageTimestamp,
    );
  }

  const error = mcpResult.error ?? fileResult.error ?? dirResult.error;
  if (error) {
    debugLogger.error(error);
    return { processedQuery: null, error };
  }

  return { processedQuery: processedQueryParts };
}

function convertResourceContentsToParts(response: {
  contents?: Array<{
    text?: string;
    blob?: string;
    mimeType?: string;
    resource?: {
      text?: string;
      blob?: string;
      mimeType?: string;
    };
  }>;
}): PartUnion[] {
  return (response.contents ?? []).flatMap((content) => {
    const candidate = content.resource ?? content;
    if (candidate.text) {
      return [{ text: candidate.text }];
    }
    if (candidate.blob) {
      const sizeBytes = Buffer.from(candidate.blob, 'base64').length;
      const mimeType = candidate.mimeType ?? 'application/octet-stream';
      return [
        {
          text: `[Binary resource content ${mimeType}, ${sizeBytes} bytes]`,
        },
      ];
    }
    return [];
  });
}
