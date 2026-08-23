# Web search tool (`web_search`)

The `web_search` tool allows the Sparkle agent to retrieve up-to-date
information, news, and facts from the internet via Google Search.

## Technical reference

The agent uses this tool when your request requires knowledge of current events
or specific online documentation not available in its internal training data.

### Arguments

- `query` (string, required): The search query to be executed.

## Technical behavior

- **Grounding:** Returns a generated summary based on search results.
- **Citations:** Includes source URIs and titles for factual grounding.
- **Processing:** The Gemini API processes the search results before returning a
  synthesized response to the agent.

## Third-party search fallback

Google Search grounding is only available through the Gemini API. When the
active provider is an OpenAI-compatible provider (see
[`security.auth.providers`](../reference/configuration.md)), the tool
automatically uses a configured third-party search API instead, returning the
results' highlights (key excerpts) with titles, URLs, and publish dates.

Configure it in `settings.json`:

```json
{
  "tools": {
    "webSearch": {
      "thirdPartyProvider": "exa",
      "apiKey": "${EXA_API_KEY}"
    }
  }
}
```

- `thirdPartyProvider`: the search API to fall back to. Supported: `"exa"`.
- `apiKey`: the provider's API key. Environment variable references such as
  `${EXA_API_KEY}` are expanded, and the `EXA_API_KEY` environment variable
  takes precedence over the settings value.

If no third-party search API is configured, the tool returns a clear error
instead of ungrounded results.

## Use cases

- Researching the latest version of a software library or API.
- Finding solutions to recent software bugs or security vulnerabilities.
- Retrieving news or documentation updated after the model's knowledge cutoff.

## Next steps

- Follow the [Web tools guide](../cli/tutorials/web-tools.md) for practical
  usage examples.
- Explore the [Web fetch tool reference](./web-fetch.md) for direct URL access.
