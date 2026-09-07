# Sparkle CLI

[![CI Badge](https://github.com/krrr/sparkle-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/krrr/sparkle-cli/actions/workflows/ci.yml)

![Main CLI Screenshot](/docs/assets/gemini-screenshot.png)

Sparkle CLI is a fork of Gemini CLI (terminal-based AI agent). The name is taken
from the shape of Gemini's icon.

## Main Changes

- Add OpenAI API support (Chat Completions)
- Add multi LLM provider switching
- Remove Google Cloud and Enterprise features (keep Gemini API)
- Boost startup speed, optimize UI smoothness
- Improve prefix cache hit rate, also reduce token usage

## Installation

`npm -g install @krrr/sparkle-cli`

Requires Node.js 20+

## Configuration

Set up LLM provider and its models in GUI.

## Fork

Initially forked from https://github.com/google-gemini/gemini-cli/commits
57f9688 in main branch.
