# Sparkle CLI changelog

Notable changes to Sparkle CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.2] - 2026-09-xx

This release introduces multiple LLM provider profiles, model tier routing,
per-model reasoning effort controls, expanded OpenAI-compatible thinking
support, third-party web search, session forking, Windows VT input support, and
extensive performance and session management improvements.

### Added

- Multiple LLM provider profiles: configure and switch between multiple provider
  endpoints, API keys, and custom model lists, with direct provider model
  management in the model selection dialog.
- Model tier routing: provider profiles map abstract model tiers (`pro`,
  `flash`, `flash-lite`, `auto`) to provider-specific models for dynamic routing
  across tools and subagents.
- Per-model reasoning effort: configurable `reasoningEffort` (`none`, `low`,
  `medium`, `high`, `max`) per model in provider settings and `settings.json`.
- OpenAI-compatible reasoning & thinking: support for `thinking` and `reasoning`
  fields alongside `reasoning_content` from OpenAI-compatible relays, with live
  inline thinking display.
- Third-party web search tool: support for external web search providers,
  including Exa search and configurable web search endpoints.
- Chat forking: `/fork` command to branch existing conversations into new
  sessions while preserving conversation metadata and context.
- Deferred session file creation: session JSONL files are now created on disk
  only when the first user message is sent, eliminating empty session files on
  startup.
- Windows Virtual Terminal input: native `SetConsoleMode` patching (`koffi`) to
  maintain VT input mode across raw-mode toggles, enabling modified keys, Kitty
  keyboard protocol, mouse events, and bracketed paste in Windows Terminal.
- Two-press session deletion: confirmation prompt (`d` twice to delete, `Esc` to
  cancel) in the session browser.
- Session index metadata: dedicated `.index.json` metadata files for session
  JSONL logs to speed up session discovery and eliminate redundant writes on
  resume.
- History deletion on clear: `-d` flag for `/clear` to clear active context and
  delete the current session file.

### Changed

- Renamed `/resume` to `/chat` as the primary session browser and checkpoint
  management command (`/resume` is retained as an alias).
- Moved per-project persistent state (sessions, memory, checkpoints, logs) from
  `~/.sparkle/tmp/<project-id>` to dedicated `~/.sparkle/data/<project-id>`, and
  stored checkpoint git shadow repositories under the project data directory.
- Standardized session storage exclusively on JSONL format, removing legacy
  single-document `.json` session parsing and migration.
- Replaced the `/auth` footer item with `/provider` (showing the active provider
  profile name), unified footer configuration under `ui.footer.items`, and
  renamed `ui.showUserIdentity` to `ui.showProviderInfo`.
- Renamed `/compress` to `/compact`, and removed deprecated `/auth`, `/docs`,
  and `/shortcuts` commands.
- Expanded `DEFAULT_IGNORED_FOLDERS` with 23 common VCS, IDE, and build cache
  directories, and improved folder truncation reporting in directory inspection.
- Preserved LLM prefix caching by avoiding topic updates injection into the
  system prompt, and relaxed update topic cadence to chapter transitions.
- Aligned grep fallback glob semantics with ripgrep (`**/*.ext` matching across
  nested directories) and removed the system grep fallback.
- Upgraded to a vendored Ink library with concurrent rendering, DECSET 2026
  synchronization, and fixed trailing blank lines.
- Increased default agent timeout and turn limit thresholds.

### Removed

- LLM auto-correction of failed edit tool calls and the unused `instruction`
  parameter from the replace tool.
- Next-speaker checker feature that caused recursive turn continuation loops.
- Obsolete settings `experimental.topicUpdateNarration`, `experimental.gemma`,
  and legacy release channel options (nightly/preview).
- Antigravity-specific promotions and branding prompts.

### Fixed

- Loss of first user message and executed tool metadata after session resume by
  preserving durable turn IDs and tool call details across tool output masking.
- Tool call ID desynchronization and prefix stripping when resuming
  conversations with strict OpenAI-compatible providers.
- Background shell execution hangs when stdio pipes remain open, reliable
  delivery of background notifications through a single channel, and missing
  output for fast-exiting background commands.
- Dangling tool calls during loop recovery by committing pending tool responses
  before recursion.
- Thought subject parsing mistakenly treating inline bold text as subjects,
  preserved formatting and indentation for plain-text OpenAI reasoning lines,
  and restored zero-latency rendering for initial thought chunks.
- Custom slash command turns being omitted from the rewind menu.
- PowerShell command substitution false positives for grouping and arithmetic
  expressions.

## [0.0.1] - 2026-08-xx

Sparkle CLI started as a fork of Gemini CLI. This first release removes
Google-specific features, rebrands the project, adds OpenAI API compatibility.

### Added

- OpenAI API format support for models, including an OpenAI-compatible base URL
  configuration and API key management in the settings screen.
- Tokens per second (TPS) and time-to-first-token (TTFT) metrics in the model
  statistics display.

### Changed

- Rebranded the project from Gemini CLI to Sparkle CLI, including package names,
  program name, prompts, and user-facing copy.
- Renamed the `.gemini` directory to `.sparkle` and replaced `GEMINI.md` with a
  generic `AGENTS.md`.
- Renamed `GEMINI_`-prefixed environment variables.
- Merged gateway authentication into the Gemini API key authentication flow.
- Set the default model to `latest` and always enabled
  `DynamicModelConfiguration`, removing the preview model mechanism and the
  older configuration path.
- Hid tool calls and other non-meaningful entries from the rewind menu.
- Use model aliases in subagent configuration instead of concrete model names.
- Dynamic routing of tool models by the active provider profile, so tier aliases
  (pro/flash/flash-lite) resolve to the active provider's models.
- Reworked the `/stats` statistics page: cache reads are now shown as a cache
  hit rate percentage, and the summary layout was simplified.

### Removed

- Google Cloud Platform (GCP) related code, including GCP deployment
  configuration and Dockerfiles.
- Enterprise Admin Controls, billing logic, admin policy, and local Gemma
  deployment management, including the `experimental.gemma` setting.
- Clearcut telemetry and remote telemetry upload; telemetry now stays local.
- The Conseca security engine.
- The `/bug` and `/privacy` slash commands, the `logout` command, and the
  `setupGithub` command with its triage functionality.
- macOS seatbelt sandboxing; macOS now runs locally unless container sandboxing
  is enabled.
- The `experiments` directory, bot tools, Google-specific GitHub scripts, and
  the lychee link checker.

### Fixed

- Internal messages such as `[Function Call: ...]` and tool calls appearing as
  user messages in resumed conversations.
- The `Thinking...` indicator no longer shows while tool calls execute.
- Tool call displayed as user message in resumed session.
