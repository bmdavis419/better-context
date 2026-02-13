# btca API + CLI Spec (Local + Cloud APIs)

This document is an audit‑ready reference for btca v2 covering:

- Local server HTTP API (btca-server)
- Local CLI commands (btca)
- Cloud APIs used by hosted integrations
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

btca reads credentials from OpenCode’s auth storage:

- **Linux/macOS**: `~/.local/share/opencode/auth.json`
- **Windows**: `%APPDATA%/opencode/auth.json`

Supported providers:

- `opencode` — API key
- `openrouter` — API key
- `openai` — OAuth (no API keys)
- `openai-compat` — optional API key (requires baseURL + name in config)
- `anthropic` — API key
- `google` — API key or OAuth
- `minimax` — API key

Environment variable overrides:

- `OPENCODE_API_KEY` (for provider `opencode`)
- `OPENROUTER_API_KEY` (for provider `openrouter`)
- `MINIMAX_API_KEY` (for provider `minimax`)

### 2.2 CLI connect/disconnect

**`btca connect`**:

- If provider is `openai`, runs local OAuth flow (PKCE) and writes tokens into OpenCode auth.
- If provider is `openai-compat`, prompts for base URL, provider name, model ID, and optional API key.
- If provider is `opencode`, `openrouter`, `anthropic`, `google`, or `minimax`, prompts for API key and writes into OpenCode auth.
- If provider is not handled directly, falls back to `opencode auth --provider <provider>`.

**OpenAI-compatible provider inputs (and why):**

- `baseURL` (required): the root URL for your OpenAI-compatible server (e.g., LM Studio, Ollama, local gateway). The AI SDK appends its own endpoint paths to this base URL.
- `name` (required): provider identifier used by the AI SDK to namespace requests and model bindings.
- `model id` (required): stored in `btca.config.jsonc` as the `model` field and used for all requests to select the model on your server.
- `api key` (optional): only needed if your server requires auth; stored in OpenCode auth and sent as a bearer token.

**`btca disconnect`**:

- Removes provider entry from OpenCode auth file (env vars remain).

### 2.3 Cloud API auth

Cloud API requests include:

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
			"specialNotes": "Focus on docs content"
		},
		{
			"type": "local",
			"name": "internal-docs",
			"path": "/abs/path/docs"
		}
	]
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

## 4. CLI Spec (Local)

### 4.1 Global options

All commands support:

- `--server <url>` — Use existing server (health checked)
- `--port <port>` — Port for auto-started server (default: `0`, OS-assigned)
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

**TUI command palette (`/`)**:

- `/connect` — configure provider and model
- `/add` — add a new resource
- `/clear` — clear chat history
- `/resume` — resume a previous thread
- `/new` — alias for `/clear`

**TUI keyboard shortcuts**:

- `Enter` — send message
- `Escape` — cancel streaming response (press twice to confirm)
- `Ctrl+C` — clear input or quit
- `Ctrl+Q` — quit
- `Tab` — autocomplete commands/mentions
- `Up/Down` — navigate palettes/history

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

### 4.9 `btca skill`

Run the skills.sh installer for the btca CLI skill (interactive).

### 4.10 `btca init`

Project setup wizard.

Options:

- `-f, --force` — overwrite config

Behavior:

- Creates `btca.config.jsonc`
- Prompts for storage mode (`local` `.btca/` or global)
- Handles `.btca/` and `.gitignore` when local storage is selected

### 4.11 `btca clear`

Clears all locally cloned resources.

### 4.12 `btca serve`

Starts local server.

Options:

- `-p, --port <port>` (default `8080`)

### 4.13 `btca mcp`

Runs the local MCP server over stdio.

Behavior:

- Starts (or reuses) the local server with quiet logging.
- Exposes MCP tools over stdin/stdout for local resources.

Tools:

- `listResources`
- `ask`

### 4.14 `btca mcp local`

Scaffolds MCP configuration for a local stdio server.

Behavior:

- Prompts for an editor (Cursor, OpenCode, Codex, Claude Code).
- Writes a project config entry for that editor.

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
	],
	"usage": {
		"inputTokens": 1234,
		"outputTokens": 456,
		"reasoningTokens": 120,
		"totalTokens": 1690
	},
	"metrics": {
		"timing": { "totalMs": 5321, "genMs": 2710 },
		"throughput": {
			"outputTokensPerSecond": 168.3,
			"totalTokensPerSecond": 623.6
		},
		"pricing": {
			"source": "models.dev",
			"modelKey": "openai/gpt-4o-mini",
			"ratesUsdPerMTokens": { "input": 0.14, "output": 0.54 },
			"costUsd": { "input": 0.000173, "output": 0.000246, "total": 0.000419 }
		}
	}
}
```

Notes:

- `usage` and `metrics` are optional and may be omitted if unavailable.
- Pricing is best-effort: it may be omitted if the model cannot be mapped or the lookup times out.
- Pricing rates are USD per 1M tokens from `https://models.dev/api.json`.
- `reasoningTokens` availability depends on provider/model.

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

## 9. Remote Cloud API

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

---
