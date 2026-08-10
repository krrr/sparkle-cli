# Frequently asked questions (FAQ)

This page provides answers to common questions and solutions to frequent
problems encountered while using Sparkle CLI.

## General issues

This section addresses common questions about Sparkle CLI usage, security, and
troubleshooting general errors.

### Why can't I use third-party software like Claude Code, OpenClaw, or OpenCode with Sparkle CLI?

Using third-party software, tools, or services to harvest or piggyback on
Sparkle CLI's authentication credentials to access our backend services is a
direct violation of our [applicable terms and policies](tos-privacy.md). Doing
so bypasses our intended authentication and security structures, and such
actions may be grounds for immediate suspension or termination of your account.
If you would like to use a third-party coding agent with Sparkle, the supported
and secure method is to use a Google AI Studio API key.

### Why am I getting an `API error: 429 - Resource exhausted`?

This error indicates that you have exceeded your API request limit. The Gemini
API has rate limits to prevent abuse and ensure fair usage.

To resolve this, you can:

- **Check your usage:** Review your API usage in the Google AI Studio dashboard.
- **Optimize your prompts:** If you are making many requests in a short period,
  try to batch your prompts or introduce delays between requests.
- **Request a quota increase:** If you consistently need a higher limit, you can
  request a quota increase from Google.

### Why am I getting an `ERR_REQUIRE_ESM` error when running `npm run start`?

This error typically occurs in Node.js projects when there is a mismatch between
CommonJS and ES Modules.

This is often due to a misconfiguration in your `package.json` or
`tsconfig.json`. Ensure that:

1.  Your `package.json` has `"type": "module"`.
2.  Your `tsconfig.json` has `"module": "NodeNext"` or a compatible setting in
    the `compilerOptions`.

If the problem persists, try deleting your `node_modules` directory and
`package-lock.json` file, and then run `npm install` again.

### Why don't I see cached token counts in my stats output?

Cached token information is only displayed when cached tokens are being used.
This feature is available for users authenticating with a Gemini API key. You
can still view your total token usage using the `/stats` command in Sparkle CLI.

## Installation and updates

### How do I check which version of Sparkle CLI I'm currently running?

You can check your current Sparkle CLI version using one of these methods:

- Run `sparkle --version` or `sparkle -v` from your terminal
- Check the globally installed version using your package manager:
  - npm: `npm list -g sparkle-cli`
  - pnpm: `pnpm list -g sparkle-cli`
  - yarn: `yarn global list sparkle-cli`
  - bun: `bun pm ls -g sparkle-cli`
  - homebrew: `brew list --versions sparkle-cli`
- Inside an active Sparkle CLI session, use the `/about` command

### How do I update Sparkle CLI to the latest version?

If you installed it globally via `npm`, update it using the command
`npm install -g sparkle-cli@latest`. If you compiled it from source, pull the
latest changes from the repository, and then rebuild using the command
`npm run build`.

## Platform-specific issues

### Why does the CLI crash on Windows when I run a command like `chmod +x`?

Commands like `chmod` are specific to Unix-like operating systems (Linux,
macOS). They are not available on Windows by default.

To resolve this, you can:

- **Use Windows-equivalent commands:** Instead of `chmod`, you can use `icacls`
  to modify file permissions on Windows.
- **Use a compatibility layer:** Tools like Git Bash or Windows Subsystem for
  Linux (WSL) provide a Unix-like environment on Windows where these commands
  will work.

## Configuration

### What is the best way to store my API keys securely?

Exposing API keys in scripts or checking them into source control is a security
risk.

To store your API keys securely, you can:

- **Use a `.env` file:** Create a `.env` file in your project's `.gemini`
  directory (`.gemini/.env`) and store your keys there. Sparkle CLI will
  automatically load these variables.
- **Use your system's keyring:** For the most secure storage, use your operating
  system's secret management tool (like macOS Keychain, Windows Credential
  Manager, or a secret manager on Linux). You can then have your scripts or
  environment load the key from the secure storage at runtime.

### Where are Sparkle CLI configuration and settings files stored?

Sparkle CLI configuration is stored in two `settings.json` files:

1.  In your home directory: `~/.gemini/settings.json`.
2.  In your project's root directory: `./.gemini/settings.json`.

Refer to [Sparkle CLI Configuration](../reference/configuration.md) for more
details.

## Not seeing your question?

Search the
[Sparkle CLI Q&A discussions on GitHub](https://github.com/krrr/sparkle-cli/discussions/categories/q-a)
or
[start a new discussion on GitHub](https://github.com/krrr/sparkle-cli/discussions/new?category=q-a)
