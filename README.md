# Sparkle CLI

Sparkle CLI is a fork of Gemini CLI (terminal-based AI agent). The name is taken
from the shape of Gemini's icon.

## Main Changes

- Add OpenAI API support (Chat Completions)
- Add multi LLM provider switching
- Remove Google Cloud and Enterprise features (keep Gemini API)
- Boost startup speed, optimize UI smoothness

## Installation

Build and install from source. Requires Node.js 20+

1. Install dependency: `npm install`

2. Build and package: `npm pack`

3. Install globally: `npm install -g ./sparkle-cli-<version>.tgz`

4. Start: `sparkle`

## Configuration

Set up LLM provider in GUI or `~/.sparkle/.env`

```
OPENAI_API_KEY=sk-youshouldneverdothis
SPARKLE_MODEL=deepseek-v4-flash
#SPARKLE_MODEL=gpt-5.6-luna
OPENAI_BASE_URL=https://opencode.ai/zen/go/v1
```

## Fork

Initially forked from https://github.com/google-gemini/gemini-cli/commits
57f9688 in main branch.
