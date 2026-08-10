# Remote Subagents

Sparkle CLI supports connecting to remote subagents using the Agent-to-Agent
(A2A) protocol. This allows Sparkle CLI to interact with other agents, expanding
its capabilities by delegating tasks to remote services.

Sparkle CLI can connect to any compliant A2A agent. You can find samples of A2A
agents in the following repositories:

- [ADK Samples (Python)](https://github.com/google/adk-samples/tree/main/python)
- [ADK Python Contributing Samples](https://github.com/google/adk-python/tree/main/contributing/samples)

## Proxy support

Sparkle CLI routes traffic to remote agents through an HTTP/HTTPS proxy if one
is configured. It uses the `general.proxy` setting in your `settings.json` file
or standard environment variables (`HTTP_PROXY`, `HTTPS_PROXY`).

```json
{
  "general": {
    "proxy": "http://my-proxy:8080"
  }
}
```

## Defining remote subagents

Remote subagents are defined as Markdown files (`.md`) with YAML frontmatter.
You can place them in:

1.  **Project-level:** `.gemini/agents/*.md` (Shared with your team)
2.  **User-level:** `~/.gemini/agents/*.md` (Personal agents)

### Configuration schema

| Field             | Type   | Required | Description                                                                                                    |
| :---------------- | :----- | :------- | :------------------------------------------------------------------------------------------------------------- |
| `kind`            | string | Yes      | Must be `remote`.                                                                                              |
| `name`            | string | Yes      | A unique name for the agent. Must be a valid slug (lowercase letters, numbers, hyphens, and underscores only). |
| `agent_card_url`  | string | Yes\*    | The URL to the agent's A2A card endpoint. Required if `agent_card_json` is not provided.                       |
| `agent_card_json` | string | Yes\*    | The inline JSON string of the agent's A2A card. Required if `agent_card_url` is not provided.                  |
| `auth`            | object | No       | Authentication configuration. See [Authentication](#authentication).                                           |

### Single-subagent example

```markdown
---
kind: remote
name: my-remote-agent
agent_card_url: https://example.com/agent-card
---
```

### Multi-subagent example

The loader explicitly supports multiple remote subagents defined in a single
Markdown file.

```markdown
---
- kind: remote
  name: remote-1
  agent_card_url: https://example.com/1
- kind: remote
  name: remote-2
  agent_card_url: https://example.com/2
---
```

<!-- prettier-ignore -->
> [!NOTE] Mixed local and remote agents, or multiple local agents, are not
> supported in a single file; the list format is currently remote-only.

### Inline Agent Card JSON

<details>
<summary>View formatting options for JSON strings</summary>

If you don't have an endpoint serving the agent card, you can provide the A2A
card directly as a JSON string using `agent_card_json`.

When providing a JSON string in YAML, you must properly format it as a string
scalar. You can use single quotes, a block scalar, or double quotes (which
require escaping internal double quotes).

#### Using single quotes

Single quotes allow you to embed unescaped double quotes inside the JSON string.
This format is useful for shorter, single-line JSON strings.

```markdown
---
kind: remote
name: single-quotes-agent
agent_card_json:
  '{ "protocolVersion": "0.3.0", "name": "Example Agent", "version": "1.0.0",
  "url": "dummy-url" }'
---
```

#### Using a block scalar

The literal block scalar (`|`) preserves line breaks and is highly recommended
for multiline JSON strings as it avoids quote escaping entirely. The following
is a complete, valid Agent Card configuration using dummy values.

```markdown
---
kind: remote
name: block-scalar-agent
agent_card_json: |
  {
    "protocolVersion": "0.3.0",
    "name": "Example Agent Name",
    "description": "An example agent description for documentation purposes.",
    "version": "1.0.0",
    "url": "dummy-url",
    "preferredTransport": "HTTP+JSON",
    "capabilities": {
      "streaming": true,
      "extendedAgentCard": false
    },
    "defaultInputModes": [
      "text/plain"
    ],
    "defaultOutputModes": [
      "application/json"
    ],
    "skills": [
      {
        "id": "ExampleSkill",
        "name": "Example Skill Assistant",
        "description": "A description of what this example skill does.",
        "tags": [
          "example-tag"
        ],
        "examples": [
          "Show me an example."
        ]
      }
    ]
  }
---
```

#### Using double quotes

Double quotes are also supported, but any internal double quotes in your JSON
must be escaped with a backslash.

```markdown
---
kind: remote
name: double-quotes-agent
agent_card_json:
  '{ "protocolVersion": "0.3.0", "name": "Example Agent", "version": "1.0.0",
  "url": "dummy-url" }'
---
```

</details>

## Authentication

Many remote agents require authentication. Sparkle CLI supports several
authentication methods aligned with the
[A2A security specification](https://a2a-protocol.org/latest/specification/#451-securityscheme).
Add an `auth` block to your agent's frontmatter to configure credentials.

### Supported auth types

Sparkle CLI supports the following authentication types:

| Type     | Description                                                                           |
| :------- | :------------------------------------------------------------------------------------ |
| `apiKey` | Send a static API key as an HTTP header.                                              |
| `http`   | HTTP authentication (Bearer token, Basic credentials, or any IANA-registered scheme). |
| `oauth`  | OAuth 2.0 Authorization Code flow with PKCE. Opens a browser for interactive sign-in. |

### Dynamic values

For `apiKey` and `http` auth types, secret values (`key`, `token`, `username`,
`password`, `value`) support dynamic resolution:

| Format      | Description                                         | Example            |
| :---------- | :-------------------------------------------------- | :----------------- |
| `$ENV_VAR`  | Read from an environment variable.                  | `$MY_API_KEY`      |
| `!command`  | Execute a shell command and use the trimmed output. | `!gh auth token`   |
| literal     | Use the string as-is.                               | `sk-abc123`        |
| `$$` / `!!` | Escape prefix. `$$FOO` becomes the literal `$FOO`.  | `$$NOT_AN_ENV_VAR` |

> **Security tip:** Prefer `$ENV_VAR` or `!command` over embedding secrets
> directly in agent files, especially for project-level agents checked into
> version control.

### API key (`apiKey`)

Sends an API key as an HTTP header on every request.

| Field  | Type   | Required | Description                                           |
| :----- | :----- | :------- | :---------------------------------------------------- |
| `type` | string | Yes      | Must be `apiKey`.                                     |
| `key`  | string | Yes      | The API key value. Supports dynamic values.           |
| `name` | string | No       | Header name to send the key in. Default: `X-API-Key`. |

```yaml
---
kind: remote
name: my-agent
agent_card_url: https://example.com/agent-card
auth:
  type: apiKey
  key: $MY_API_KEY
---
```

### HTTP authentication (`http`)

Supports Bearer tokens, Basic auth, and arbitrary IANA-registered HTTP
authentication schemes.

#### Bearer token

Use the following fields to configure a Bearer token:

| Field    | Type   | Required | Description                                |
| :------- | :----- | :------- | :----------------------------------------- |
| `type`   | string | Yes      | Must be `http`.                            |
| `scheme` | string | Yes      | Must be `Bearer`.                          |
| `token`  | string | Yes      | The bearer token. Supports dynamic values. |

```yaml
auth:
  type: http
  scheme: Bearer
  token: $MY_BEARER_TOKEN
```

#### Basic authentication

Use the following fields to configure Basic authentication:

| Field      | Type   | Required | Description                            |
| :--------- | :----- | :------- | :------------------------------------- |
| `type`     | string | Yes      | Must be `http`.                        |
| `scheme`   | string | Yes      | Must be `Basic`.                       |
| `username` | string | Yes      | The username. Supports dynamic values. |
| `password` | string | Yes      | The password. Supports dynamic values. |

```yaml
auth:
  type: http
  scheme: Basic
  username: $MY_USERNAME
  password: $MY_PASSWORD
```

#### Raw scheme

For any other IANA-registered scheme (for example, Digest, HOBA), provide the
raw authorization value.

| Field    | Type   | Required | Description                                                                   |
| :------- | :----- | :------- | :---------------------------------------------------------------------------- |
| `type`   | string | Yes      | Must be `http`.                                                               |
| `scheme` | string | Yes      | The scheme name (for example, `Digest`).                                      |
| `value`  | string | Yes      | Raw value sent as `Authorization: <scheme> <value>`. Supports dynamic values. |

```yaml
auth:
  type: http
  scheme: Digest
  value: $MY_DIGEST_VALUE
```

### OAuth 2.0 (`oauth`)

Performs an interactive OAuth 2.0 Authorization Code flow with PKCE. On first
use, Sparkle CLI opens your browser for sign-in and persists the resulting
tokens for subsequent requests.

| Field               | Type     | Required | Description                                                                                                                                        |
| :------------------ | :------- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`              | string   | Yes      | Must be `oauth`.                                                                                                                                   |
| `client_id`         | string   | Yes\*    | OAuth client ID. Required for interactive auth.                                                                                                    |
| `client_secret`     | string   | No\*     | OAuth client secret. Required by most authorization servers (confidential clients). Can be omitted for public clients that don't require a secret. |
| `scopes`            | string[] | No       | Requested scopes. Can also be discovered from the agent card.                                                                                      |
| `authorization_url` | string   | No       | Authorization endpoint. Discovered from the agent card if omitted.                                                                                 |
| `token_url`         | string   | No       | Token endpoint. Discovered from the agent card if omitted.                                                                                         |

```yaml
---
kind: remote
name: oauth-agent
agent_card_url: https://example.com/.well-known/agent.json
auth:
  type: oauth
  client_id: my-client-id.apps.example.com
---
```

If the agent card advertises an `oauth2` security scheme with
`authorizationCode` flow, the `authorization_url`, `token_url`, and `scopes` are
automatically discovered. You only need to provide `client_id` (and
`client_secret` if required).

Tokens are persisted to disk and refreshed automatically when they expire.

### Auth validation

When Sparkle CLI loads a remote agent, it validates your auth configuration
against the agent card's declared `securitySchemes`. If the agent requires
authentication that you haven't configured, you'll see an error describing
what's needed.

### Auth retry behavior

All auth providers automatically retry on `401` and `403` responses by
re-fetching credentials (up to 2 retries). This handles cases like expired
tokens or rotated credentials. For `apiKey` with `!command` values, the command
is re-executed on retry to fetch a fresh key.

### Agent card fetching and auth

When connecting to a remote agent, Sparkle CLI first fetches the agent card
**without** authentication. If the card endpoint returns a `401` or `403`, it
retries the fetch **with** the configured auth headers. This lets agents have
publicly accessible cards while protecting their task endpoints, or to protect
both behind auth.

## Managing Subagents

Users can manage subagents using the following commands within Sparkle CLI:

- `/agents list`: Displays all available local and remote subagents.
- `/agents reload`: Reloads the agent registry. Use this after adding or
  modifying agent definition files.
- `/agents enable <agent_name>`: Enables a specific subagent.
- `/agents disable <agent_name>`: Disables a specific subagent.

<!-- prettier-ignore -->
> [!TIP]
> You can use the `@cli_help` agent within Sparkle CLI for assistance
> with configuring subagents.

## Disabling remote agents

Remote subagents are enabled by default. To disable them, set `enableAgents` to
`false` in your `settings.json`:

```json
{
  "experimental": {
    "enableAgents": false
  }
}
```
