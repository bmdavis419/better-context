# BTCA API + CLI Spec (Local + Remote)

This document is an audit‑ready reference for BTCA v2 covering:

- Local server HTTP API (btca-server)
- Local CLI commands (btca)
- Remote CLI commands (btca remote)
- Remote cloud APIs used by the CLI
- Authentication and installation
- Configuration files, validation, and limits

All details reflect the current repo state.

---

## 1. Installation

### CLI (global)

```bash
bun add -g btca
```

### Server library

```bash
bun add btca-server
```

### Runtime requirements

- **Bun** is required.

---

## 2. Authentication

### 2.1 Local provider auth (used by btca-server)

BTCA reads credentials from OpenCode’s auth storage:

- **Linux/macOS**: `~/.local/share/opencode/auth.json`
- **Windows**: `%APPDATA%/opencode/auth.json`

Supported providers:

- `opencode` — API key
- `openrouter` — API key
- `openai` — OAuth (no API keys)
- `openai-compat` — optional API key (requires baseURL + name in config)
- `anthropic` — API key
- `google` — API key or OAuth

Environment variable overrides:

- `OPENCODE_API_KEY` (for provider `opencode`)
- `OPENROUTER_API_KEY` (for provider `openrouter`)

### 2.2 CLI connect/disconnect

**`btca connect`**:

- If provider is `openai`, runs local OAuth flow (PKCE) and writes tokens into OpenCode auth.
- If provider is `openai-compat`, prompts for base URL, provider name, model ID, and optional API key.
- If provider is `opencode`, `openrouter`, `anthropic`, or `google`, prompts for API key and writes into OpenCode auth.
- If provider is not handled directly, falls back to `opencode auth --provider <provider>`.

**OpenAI-compatible provider inputs (and why):**

- `baseURL` (required): the root URL for your OpenAI-compatible server (e.g., LM Studio, Ollama, local gateway). The AI SDK appends its own endpoint paths to this base URL.
- `name` (required): provider identifier used by the AI SDK to namespace requests and model bindings.
- `model id` (required): stored in `btca.config.jsonc` as the `model` field and used for all requests to select the model on your server.
- `api key` (optional): only needed if your server requires auth; stored in OpenCode auth and sent as a bearer token.

**`btca disconnect`**:

- Removes provider entry from OpenCode auth file (env vars remain).

### 2.3 Remote (cloud) auth

Remote commands require an API key stored at:

```
~/.config/btca/remote-auth.json
```

Structure:

```json
{
  "apiKey": "btca_xxxxxxxxxxxx",
  "linkedAt": 1706000000000
}
```

All remote requests include:

```
Authorization: Bearer <apiKey>
```

---

## 3. Configuration Files

### 3.1 Local config: `btca.config.jsonc`

- **Project config**: `./btca.config.jsonc`
- **Global config**: `~/.config/btca/btca.config.jsonc`
- JSONC supported (comments + trailing commas)
- **Precedence**: global loaded first, project merged on top (project overrides conflicts)
- If project config exists, data directory resolves relative to project.

Example:

```jsonc
{
  "$schema": "https://btca.dev/btca.schema.json",
  "provider": "opencode",
  "model": "claude-haiku-4-5",
  "dataDirectory": ".btca",
  "providerOptions": {
    "openai-compat": {
      "baseURL": "http://localhost:1234/v1",
      "name": "lmstudio"
    }
  },
  "resources": [
    {
      "type": "git",
      "name": "svelte",
      "url": "https://github.com/sveltejs/svelte.dev",
      "branch": "main",
      "searchPath": "apps/svelte.dev",
      "specialNotes": "Focus on docs content",
    },
    {
      "type": "local",
      "name": "internal-docs",
      "path": "/abs/path/docs",
    },
  ],
}
```

**Defaults (auto‑created global config if missing):**

- `provider`: `opencode`
- `model`: `claude-haiku-4-5`
- `providerTimeoutMs`: `300000`
- Default resources: `svelte`, `tailwindcss`, `nextjs`

Data storage:

- Resources are stored in `${dataDirectory}/resources`.
- If `dataDirectory` is missing and a legacy `.btca/` directory exists, the project config is migrated to use `.btca`.

### 3.2 Remote config: `btca.remote.config.jsonc`

- File: `./btca.remote.config.jsonc`
- Remote supports **git resources only**.

Example:

```jsonc
{
  "$schema": "https://btca.dev/btca.remote.schema.json",
  "project": "my-project",
  "model": "claude-sonnet",
  "resources": [
    {
      "type": "git",
      "name": "svelte",
      "url": "https://github.com/sveltejs/svelte.dev",
      "branch": "main",
      "searchPath": "apps/svelte.dev",
      "specialNotes": "Focus on docs",
    },
  ],
}
```

Remote model list (fixed):

- `claude-sonnet`
- `claude-haiku`
- `gpt-4o`
- `gpt-4o-mini`

---

## 4. CLI Spec (Local)

### 4.1 Global options

All commands support:

- `--server <url>` — Use existing server (health checked)
- `--port <port>` — Port for auto-started server
- `--no-tui` — Use REPL instead of TUI
- `--no-thinking` — Hide reasoning output (REPL/ask)
- `--no-tools` — Hide tool traces (REPL/ask)
- `--sub-agent` — Clean output (no reasoning/tool traces)

### 4.2 Default command: `btca`

Launches the TUI by default. With `--no-tui`, launches REPL.

**REPL commands**:

- `/help` — show help
- `/resources` — list resources
- `/clear` — clear session resources
- `/quit` or `/exit` — exit

REPL supports `@resource` mentions.

### 4.3 `btca add [url-or-path]`

Add a git repo or local directory resource.

Options:

- `-g, --global` — (flag exists; config target is still resolved by presence of project config)
- `-n, --name <name>`
- `-b, --branch <branch>` (default `main`)
- `-s, --search-path <path...>`
- `--notes <notes>`
- `-t, --type <git|local>`

Behavior:

- If no argument, interactive wizard.
- If `--type` omitted, auto‑detects URL vs path.
- Git URLs are normalized to base repo when GitHub.
- Local paths are resolved to absolute paths.

### 4.4 `btca remove [name]`

Remove a resource by name. If omitted, interactive picker.

Options:

- `-g, --global` — (flag exists; not implemented as a strict global override)

### 4.5 `btca resources`

List all configured resources.

### 4.6 `btca ask`

Ask a one‑shot question with streaming output.

Options:

- `-q, --question <text>` **required**
- `-r, --resource <name...>` (repeatable)
- `--no-thinking`, `--no-tools`, `--sub-agent`

Behavior:

- `@resource` mentions are resolved and merged with `-r` flags.
- Valid mentions are stripped from the query text before sending.
- If no resources specified, uses **all** configured resources.
- Uses `/question/stream` SSE endpoint.

### 4.7 `btca connect`

Configure provider + model.

Options:

- `-g, --global`
- `-p, --provider <id>`
- `-m, --model <id>`

Behavior:

- If provider/model specified, updates config.
- Otherwise, interactive provider selection (connected providers listed first), then model selection.
- Prompts for auth if required.

### 4.8 `btca disconnect`

Disconnect provider credentials.

Options:

- `-p, --provider <id>`

Behavior:

- If omitted, interactive picker.

### 4.9 `btca init`

Project setup wizard.

Options:

- `-f, --force` — overwrite config

Behavior:

- Prompts for setup type: **MCP** (remote) or **CLI** (local)
- MCP path:
  - Prompts for API key (if missing), validates it
  - Creates `btca.remote.config.jsonc`
  - Writes `.claude/skills/btca-remote/SKILL.md`
- CLI path:
  - Creates `btca.config.jsonc`
  - Handles `.btca/` and `.gitignore`
  - Writes `.claude/skills/btca-local/SKILL.md`

### 4.10 `btca clear`

Clears all locally cloned resources.

### 4.11 `btca serve`

Starts local server.

Options:

- `-p, --port <port>` (default `8080`)

## 5. CLI Spec (Remote)

All remote commands require authentication via `btca remote link`.

### 5.1 `btca remote link`

Authenticate with BTCA cloud API.

Options:

- `--key <apiKey>`

Behavior:

- Prompts for API key if not provided.
- Validates key by calling MCP listResources.

### 5.2 `btca remote unlink`

Removes stored API key.

### 5.3 `btca remote status`

Shows sandbox state, plan, version, and current project info.

### 5.4 `btca remote wake`

Pre‑warms sandbox and returns when ready.

### 5.5 `btca remote add [url]`

Adds a git resource to local remote config and syncs to cloud.

Options:

- `-n, --name <name>`
- `-b, --branch <branch>`
- `-s, --search-path <path...>`
- `--notes <notes>`

Behavior:

- Creates local config if missing (prompts for project name).
- Normalizes GitHub URLs.
- Syncs resource to cloud; warns if sync fails.

### 5.6 `btca remote sync`

Syncs local remote config with cloud.

Options:

- `--force` — overwrite cloud on conflicts

Behavior:

- Detects conflicts (same resource name but different config).

### 5.7 `btca remote ask`

Ask a question via cloud sandbox.

Options:

- `-q, --question <text>` **required**
- `-r, --resource <name...>`

Behavior:

- Validates resources by calling `listResources` first.
- If none specified, uses all available resources.

### 5.8 `btca remote grab <threadId>`

Fetch full thread transcript.

Options:

- `--json`
- `--markdown` (default)

### 5.9 `btca remote init`

Creates `btca.remote.config.jsonc`.

Options:

- `-p, --project <name>`

### 5.10 `btca remote mcp [agent]`

Outputs MCP configuration snippet:

- `opencode`: JSON config block
- `claude`: CLI command for Claude Code

---

## 6. Local Server HTTP API (btca-server)

Base URL:

- Local: `http://localhost:<port>`

No authentication required.

Error format:

```json
{ "error": "Message", "tag": "ConfigError", "hint": "Actionable hint" }
```

### 6.1 `GET /`

Health check.

Response:

```json
{ "ok": true, "service": "btca-server", "version": "0.0.1" }
```

### 6.2 `GET /config`

Returns current config.

Response:

```json
{
  "provider": "opencode",
  "model": "claude-haiku-4-5",
  "providerTimeoutMs": 300000,
  "resourcesDirectory": "/abs/path/resources",
  "resourceCount": 3
}
```

### 6.3 `GET /resources`

Lists configured resources.

Response:

```json
{
  "resources": [
    {
      "name": "svelte",
      "type": "git",
      "url": "https://github.com/sveltejs/svelte.dev",
      "branch": "main",
      "searchPath": "apps/svelte.dev",
      "searchPaths": null,
      "specialNotes": "..."
    },
    {
      "name": "internal-docs",
      "type": "local",
      "path": "/abs/path/docs",
      "specialNotes": null
    }
  ]
}
```

### 6.4 `GET /providers`

Lists supported providers and connected providers.

Response:

```json
{
  "all": [
    { "id": "opencode", "models": {} },
    { "id": "openrouter", "models": {} }
  ],
  "connected": ["opencode"]
}
```

### 6.5 `POST /reload-config`

Reloads config from disk.

Response:

```json
{ "ok": true, "resources": ["svelte", "tailwindcss"] }
```

### 6.6 `POST /question`

Ask a question (non‑streaming).

Request:

```json
{
  "question": "How do I create a store?",
  "resources": ["svelte"],
  "quiet": true
}
```

Response:

```json
{
  "answer": "...",
  "model": { "provider": "opencode", "model": "claude-haiku-4-5" },
  "resources": ["svelte"],
  "collection": { "key": "svelte", "path": "/abs/path/collection" }
}
```

### 6.7 `POST /question/stream`

Ask a question with streaming SSE output.

Request: same as `/question`.

Response: SSE event stream (see §7).

### 6.8 `PUT /config/model`

Updates provider/model.

Request:

```json
{ "provider": "opencode", "model": "claude-haiku-4-5" }
```

Response:

```json
{ "provider": "opencode", "model": "claude-haiku-4-5" }
```

### 6.9 `POST /config/resources`

Adds a new resource.

Request (git):

```json
{
  "type": "git",
  "name": "hono",
  "url": "https://github.com/honojs/website",
  "branch": "main",
  "searchPath": "docs",
  "specialNotes": "Focus on docs"
}
```

Request (local):

```json
{ "type": "local", "name": "docs", "path": "/abs/path/docs" }
```

Response: the created resource (GitHub URLs normalized to base repo).

### 6.10 `DELETE /config/resources`

Remove resource by name.

Request:

```json
{ "name": "hono" }
```

Response:

```json
{ "success": true, "name": "hono" }
```

### 6.11 `POST /clear`

Clears all cached resource clones.

Response:

```json
{ "cleared": 5 }
```

---

## 7. Streaming SSE Spec (`/question/stream`)

SSE format:

```
event: <type>
data: <json>
```

Event types:

- `meta`
- `reasoning.delta`
- `text.delta`
- `tool.updated`
- `done`
- `error`

**meta** example:

```json
{
  "type": "meta",
  "model": { "provider": "opencode", "model": "claude-haiku-4-5" },
  "resources": ["svelte"],
  "collection": { "key": "svelte", "path": "/abs/path/collection" }
}
```

**tool.updated** example:

```json
{
  "type": "tool.updated",
  "callID": "tool-1",
  "tool": "read",
  "state": { "status": "running", "input": { "path": "README.md" } }
}
```

**done** example:

```json
{
  "type": "done",
  "text": "final answer",
  "reasoning": "full reasoning",
  "tools": [
    {
      "callID": "tool-1",
      "tool": "read",
      "state": {
        "status": "completed",
        "input": { "path": "README.md" },
        "output": "..."
      }
    }
  ]
}
```

**error** example:

```json
{ "type": "error", "tag": "ConfigError", "message": "..." }
```

---

## 8. Validation & Limits

Resource name:

- Max 64 chars
- Regex: `^@?[a-zA-Z0-9][a-zA-Z0-9._-]*(/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$`
- No `..`, no `//`, no trailing `/`

Branch name:

- Max 128 chars
- Regex: `^[a-zA-Z0-9/_.-]+$`
- Must not start with `-`

Search path:

- Max 256 chars
- No `..`
- No absolute paths
- No newline characters

Special notes:

- Max 500 chars
- No control characters

Question length:

- Max 100,000 chars

Resources per request:

- Max 20

Git URL validation:

- HTTPS only
- No embedded credentials
- No localhost or private IPs
- GitHub URLs normalized to base repo

---

## 9. Remote Cloud API (used by CLI)

All remote API calls require:

```
Authorization: Bearer <apiKey>
Content-Type: application/json
```

### 9.1 MCP endpoint

`POST /api/mcp` (JSON‑RPC 2.0)

**Method**: `tools/call`

Supported tools:

- `listResources`
- `ask`
- `addResource`
- `sync`

Example payload:

```json
{
  "jsonrpc": "2.0",
  "id": 1700000000000,
  "method": "tools/call",
  "params": {
    "name": "ask",
    "arguments": {
      "question": "...",
      "resources": ["svelte"],
      "project": "default"
    }
  }
}
```

Response shape:

```json
{
  "result": {
    "content": [{ "type": "text", "text": "..." }],
    "isError": false
  }
}
```

### 9.2 CLI API endpoints (cloud)

- `GET /api/cli/status?project=<name>`
  - Returns `{ instance, project? }`
- `POST /api/cli/wake`
  - Returns `{ serverUrl }`
- `GET /api/cli/threads/:threadId`
  - Returns `{ thread, messages }`
- `GET /api/cli/threads?project=<name>`
  - Returns `{ threads }`
- `GET /api/cli/questions?project=<name>`
  - Returns `{ questions }`
- `GET /api/cli/projects`
  - Returns `{ projects }`

---

## 10. Known Gaps / Audit Notes

- `--global` flags exist on several commands, but the effective target is determined by whether a project config exists; there is no strict global override path.
- `btca remote add` defaults differ between paths:
  - Interactive path uses model `claude-haiku`.
  - Non‑interactive path uses model `claude-sonnet`.

---
