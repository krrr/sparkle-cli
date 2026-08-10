# Sparkle CLI cheatsheet

This page provides a reference for commonly used Sparkle CLI commands, options,
and parameters.

## CLI commands

| Command                             | Description                        | Example                                                        |
| ----------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `sparkle`                           | Start interactive REPL             | `sparkle`                                                      |
| `sparkle -p "query"`                | Query non-interactively            | `sparkle -p "summarize README.md"`                             |
| sparkle "query"                     | Query and continue interactively   | sparkle "explain this project"                                 |
| `cat file \| sparkle`               | Process piped content              | `cat logs.txt \| sparkle`<br>`Get-Content logs.txt \| sparkle` |
| `sparkle -i "query"`                | Execute and continue interactively | `sparkle -i "What is the purpose of this project?"`            |
| `sparkle -r "latest"`               | Continue most recent session       | `sparkle -r "latest"`                                          |
| `sparkle -r "latest" "query"`       | Continue session with a new prompt | `sparkle -r "latest" "Check for type errors"`                  |
| `sparkle -r "<session-id>" "query"` | Resume session by ID               | `sparkle -r "abc123" "Finish this PR"`                         |
| `sparkle update`                    | Update to latest version           | `sparkle update`                                               |
| `sparkle extensions`                | Manage extensions                  | See [Extensions Management](#extensions-management)            |
| `sparkle mcp`                       | Configure MCP servers              | See [MCP Server Management](#mcp-server-management)            |

### Positional arguments

| Argument | Type              | Description                                                                                                |
| -------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `query`  | string (variadic) | Positional prompt. Defaults to interactive mode in a TTY. Use `-p/--prompt` for non-interactive execution. |

## Interactive commands

These commands are available within the interactive REPL.

| Command              | Description                                     |
| -------------------- | ----------------------------------------------- |
| `/skills reload`     | Reload discovered skills from disk              |
| `/agents reload`     | Reload the agent registry                       |
| `/commands list`     | List available custom slash commands            |
| `/commands reload`   | Reload custom slash commands                    |
| `/memory reload`     | Reload context files (for example, `AGENTS.md`) |
| `/mcp reload`        | Restart and reload MCP servers                  |
| `/extensions reload` | Reload all active extensions                    |
| `/help`              | Show help for all commands                      |
| `/quit`              | Exit the interactive session                    |

## CLI Options

| Option                           | Alias | Type    | Default   | Description                                                                                                                                                            |
| -------------------------------- | ----- | ------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--debug`                        | `-d`  | boolean | `false`   | Run in debug mode with verbose logging                                                                                                                                 |
| `--version`                      | `-v`  | -       | -         | Show CLI version number and exit                                                                                                                                       |
| `--help`                         | `-h`  | -       | -         | Show help information                                                                                                                                                  |
| `--model`                        | `-m`  | string  | `auto`    | Model to use. See [Model Selection](#model-selection) for available values.                                                                                            |
| `--prompt`                       | `-p`  | string  | -         | Prompt text. Appended to stdin input if provided. Forces non-interactive mode.                                                                                         |
| `--prompt-interactive`           | `-i`  | string  | -         | Execute prompt and continue in interactive mode                                                                                                                        |
| `--worktree`                     | `-w`  | string  | -         | Start Sparkle in a new git worktree. If no name is provided, one is generated automatically. Requires `experimental.worktrees: true` in settings.                      |
| `--sandbox`                      | `-s`  | boolean | `false`   | Run in a sandboxed environment for safer execution                                                                                                                     |
| `--skip-trust`                   | -     | boolean | `false`   | Trust the current workspace for this session, skipping the folder trust check.                                                                                         |
| `--approval-mode`                | -     | string  | `default` | Approval mode for tool execution. Choices: `default`, `auto_edit`, `yolo`, `plan`                                                                                      |
| `--yolo`                         | `-y`  | boolean | `false`   | **Deprecated.** Auto-approve all actions. Use `--approval-mode=yolo` instead.                                                                                          |
| `--experimental-acp`             | -     | boolean | -         | Start in ACP (Agent Code Pilot) mode. **Experimental feature.**                                                                                                        |
| `--experimental-zed-integration` | -     | boolean | -         | Run in Zed editor integration mode. **Experimental feature.**                                                                                                          |
| `--allowed-mcp-server-names`     | -     | array   | -         | Allowed MCP server names (comma-separated or multiple flags)                                                                                                           |
| `--allowed-tools`                | -     | array   | -         | **Deprecated.** Use the [Policy Engine](../reference/policy-engine.md) instead. Tools that are allowed to run without confirmation (comma-separated or multiple flags) |
| `--extensions`                   | `-e`  | array   | -         | List of extensions to use. If not provided, all extensions are enabled (comma-separated or multiple flags)                                                             |
| `--list-extensions`              | `-l`  | boolean | -         | List all available extensions and exit                                                                                                                                 |
| `--resume`                       | `-r`  | string  | -         | Resume a previous session. Use `"latest"` for most recent or index number (for example `--resume 5`)                                                                   |
| `--list-sessions`                | -     | boolean | -         | List available sessions for the current project and exit                                                                                                               |
| `--delete-session`               | -     | string  | -         | Delete a session by index number (use `--list-sessions` to see available sessions)                                                                                     |
| `--include-directories`          | -     | array   | -         | Additional directories to include in the workspace (comma-separated or multiple flags)                                                                                 |
| `--screen-reader`                | -     | boolean | -         | Enable screen reader mode for accessibility                                                                                                                            |
| `--output-format`                | `-o`  | string  | `text`    | The format of the CLI output. Choices: `text`, `json`, `stream-json`                                                                                                   |

## Model selection

The `--model` (or `-m`) flag lets you specify which Gemini model to use. You can
use either model aliases (user-friendly names) or concrete model names.

### Model aliases

These are convenient shortcuts that map to specific models:

| Alias        | Resolves To                                | Description                                                                                                               |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `auto`       | `gemini-2.5-pro` or `gemini-3-pro-preview` | **Default.** Resolves to the preview model if preview features are enabled, otherwise resolves to the standard pro model. |
| `pro`        | `gemini-2.5-pro` or `gemini-3-pro-preview` | For complex reasoning tasks. Uses preview model if enabled.                                                               |
| `flash`      | `gemini-2.5-flash`                         | Fast, balanced model for most tasks.                                                                                      |
| `flash-lite` | `gemini-2.5-flash-lite`                    | Fastest model for simple tasks.                                                                                           |

## Extensions management

| Command                                             | Description                                  | Example                                                                         |
| --------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| `sparkle extensions install <source>`               | Install extension from Git URL or local path | `sparkle extensions install https://github.com/user/my-extension`               |
| `sparkle extensions install <source> --ref <ref>`   | Install from specific branch/tag/commit      | `sparkle extensions install https://github.com/user/my-extension --ref develop` |
| `sparkle extensions install <source> --auto-update` | Install with auto-update enabled             | `sparkle extensions install https://github.com/user/my-extension --auto-update` |
| `sparkle extensions uninstall <name>`               | Uninstall one or more extensions             | `sparkle extensions uninstall my-extension`                                     |
| `sparkle extensions list`                           | List all installed extensions                | `sparkle extensions list`                                                       |
| `sparkle extensions update <name>`                  | Update a specific extension                  | `sparkle extensions update my-extension`                                        |
| `sparkle extensions update --all`                   | Update all extensions                        | `sparkle extensions update --all`                                               |
| `sparkle extensions enable <name>`                  | Enable an extension                          | `sparkle extensions enable my-extension`                                        |
| `sparkle extensions disable <name>`                 | Disable an extension                         | `sparkle extensions disable my-extension`                                       |
| `sparkle extensions link <path>`                    | Link local extension for development         | `sparkle extensions link /path/to/extension`                                    |
| `sparkle extensions new <path>`                     | Create new extension from template           | `sparkle extensions new ./my-extension`                                         |
| `sparkle extensions validate <path>`                | Validate extension structure                 | `sparkle extensions validate ./my-extension`                                    |

See [Extensions Documentation](../extensions/index.md) for more details.

## MCP server management

| Command                                                        | Description                     | Example                                                                                               |
| -------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `sparkle mcp add <name> <command>`                             | Add stdio-based MCP server      | `sparkle mcp add github npx -y @modelcontextprotocol/server-github`                                   |
| `sparkle mcp add <name> <url> --transport http`                | Add HTTP-based MCP server       | `sparkle mcp add api-server http://localhost:3000 --transport http`                                   |
| `sparkle mcp add <name> <command> --env KEY=value`             | Add with environment variables  | `sparkle mcp add slack node server.js --env SLACK_TOKEN=xoxb-xxx`                                     |
| `sparkle mcp add <name> <command> --scope user`                | Add with user scope             | `sparkle mcp add db node db-server.js --scope user`                                                   |
| `sparkle mcp add <name> <command> --include-tools tool1,tool2` | Add with specific tools         | `sparkle mcp add github npx -y @modelcontextprotocol/server-github --include-tools list_repos,get_pr` |
| `sparkle mcp remove <name>`                                    | Remove an MCP server            | `sparkle mcp remove github`                                                                           |
| `sparkle mcp list`                                             | List all configured MCP servers | `sparkle mcp list`                                                                                    |

See [MCP Server Integration](../tools/mcp-server.md) for more details.

## Skills management

| Command                           | Description                           | Example                                            |
| --------------------------------- | ------------------------------------- | -------------------------------------------------- |
| `sparkle skills list`             | List all discovered agent skills      | `sparkle skills list`                              |
| `sparkle skills install <source>` | Install skill from Git, path, or file | `sparkle skills install https://github.com/u/repo` |
| `sparkle skills link <path>`      | Link local agent skills via symlink   | `sparkle skills link /path/to/my-skills`           |
| `sparkle skills uninstall <name>` | Uninstall an agent skill              | `sparkle skills uninstall my-skill`                |
| `sparkle skills enable <name>`    | Enable an agent skill                 | `sparkle skills enable my-skill`                   |
| `sparkle skills disable <name>`   | Disable an agent skill                | `sparkle skills disable my-skill`                  |
| `sparkle skills enable --all`     | Enable all skills                     | `sparkle skills enable --all`                      |
| `sparkle skills disable --all`    | Disable all skills                    | `sparkle skills disable --all`                     |

See [Agent Skills Documentation](./skills.md) for more details.
