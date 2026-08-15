# Sparkle CLI changelog

Notable changes to Sparkle CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-08-xx

Sparkle CLI started as a fork of Gemini CLI. This first release removes
Google-specific features, rebrands the project, adds OpenAI API compatibility.

### Added

- OpenAI API format support for models, including an OpenAI-compatible base URL
  configuration and API key management in the settings screen.

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
- Using Model aliases in subagent configuration instead of concrete model names.
- Dynamic routing of tool models by active model family, letting models on the
  same tier chain (for example, DeepSeek) be reused.

### Removed

- Google Cloud Platform (GCP) related code, including GCP deployment
  configuration and Dockerfiles.
- Enterprise Admin Controls, billing logic, and local Gemma deployment
  management, including the `experimental.gemma` setting.
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
