# CLI + Server API Surface & Primitives (Baseline)

## Scope
- Focus: `apps/cli` and `apps/server` only.
- Web app excluded.
- Goal: capture all public-facing APIs (CLI commands, server routes, config files), plus internal primitives to preserve behavior in Effect rewrite.

---

## CLI (`apps/cli`) — Public Surface

### Binary
- `btca` (bin: `apps/cli/bin.js`, entry `apps/cli/src/index.ts`).
- Global options (top-level):
  - `--server <url>` use existing btca server URL.
  - `--port <port>` port for auto-started server (default random in manager).
  - `--no-tui` use REPL mode instead of TUI.
  - `-v, --version` prints version (injected `__VERSION__` fallback to package.json).

### Commands

#### `btca` (no subcommand)
- Launches TUI by default; REPL if `--no-tui`.
- Calls `ensureServer` to either health-check provided server or start in-process server.

#### `btca ask`
- Options: `-q, --question <text>` (required), `-r, --resource <name...>` (optional).
- Supports inline `@mentions` in question. Mentioned resources are merged with `-r` resources.
- If no resources specified/mentioned, uses all available resources.
- Removes valid `@resource` tokens from the question before sending to server.
- Streams SSE from `POST /question/stream` and prints:
  - `meta` → "creating collection..."
  - `reasoning.delta` → printed inside `<thinking>` block
  - `text.delta` → streamed to stdout
  - `tool.updated` (running) → prints `[toolName]`
- Error handling uses `BtcaError` for server hints.
- Exits process with `0/1`.

#### `btca add`
- Add resource interactively or non-interactively.
- Accepts positional `[url-or-path]` plus flags:
  - `-g, --global` (currently passes through, server mutates active config only)
  - `-n, --name <name>`
  - `-b, --branch <branch>` (git)
  - `-s, --search-path <path...>` (git)
  - `--notes <notes>`
  - `-t, --type <git|local>`
- Auto-detects git vs local by URL heuristics.
- Git URL normalization: GitHub repo URL normalized (removes `.git`).
- Uses `POST /config/resources`.

#### `btca remove`
- Removes resource by name or interactive picker.
- Uses `DELETE /config/resources`.

#### `btca clear`
- Clears locally cloned resources.
- Uses `POST /clear`.

#### `btca connect`
- Interactive configuration of provider + model.
- Uses `GET /providers` to show supported/connected providers.
- Uses `PUT /config/model` to update.
- Can trigger `opencode auth` via `bun spawn` for providers that require auth.

#### `btca config`
- Subcommands:
  - `config model -p <provider> -m <model>` → `PUT /config/model` + optional provider/model validation.
  - `config resources list` → `GET /resources`.
  - `config resources add` → `POST /config/resources`.
  - `config resources remove` → `DELETE /config/resources`.

#### `btca serve`
- Starts server in-process (`btca-server` startServer), logs URL.
- Handles SIGINT/SIGTERM for clean shutdown.

#### `btca chat`
- Uses `POST /opencode` to get OpenCode instance URL, spawns `opencode attach <url>`.

#### `btca repl`
- Non-TUI REPL; streams `POST /question/stream`.
- Supports `@mentions`, session resources, and `/commands`:
  - `/help`, `/resources`, `/clear`, `/quit`/`/exit`.

#### `btca remote ...`
- Cloud/MCP mode (btca.dev):
  - Auth stored at `~/.config/btca/remote-auth.json`.
  - Config stored at `./btca.remote.config.jsonc` (JSONC w/ schema).
  - Uses `RemoteClient` (JSON-RPC via `/api/mcp`, plus `/api/cli/*` endpoints).
  - Subcommands: `link`, `unlink`, `status`, `wake`, `add`, `sync`, `ask`, `grab`, `init`.

### CLI Internal Primitives
- `ensureServer` (`apps/cli/src/server/manager.ts`)
  - If `--server` specified: health check `GET /`.
  - Else starts server via `startServer({ port })` and waits for healthy.
- `client/index.ts` (Hono RPC + raw fetch)
  - `createClient`, `getConfig`, `getResources`, `getProviders`, `askQuestion`, `askQuestionStream`, `getOpencodeInstance`, `updateModel`, `addResource`, `removeResource`, `clearResources`.
  - Error type: `BtcaError` with `hint` and `tag` from server.
- `client/stream.ts`
  - SSE parser that validates events against `BtcaStreamEventSchema`.
- TUI (`apps/cli/src/tui`)
  - Uses `@opentui/solid` / SolidJS components.
  - `services.ts` wraps server client; tracks current AbortController.
  - Stream event aggregation into `BtcaChunk` types for UI.
- Utilities: color helpers, markdown renderer, etc.

---

## Server (`apps/server`) — Public Surface

### Runtime
- Bun server + Hono app. Start with `startServer({ port })` or `import.meta.main` auto-start.
- Default port `8080` unless `PORT` env set.

### HTTP Routes
All routes are defined in `apps/server/src/index.ts` and are part of the API contract.

#### Health
- `GET /` → `{ ok: true, service: "btca-server", version: "0.0.1" }`.

#### Config / Resources
- `GET /config` → current provider/model, timeouts, directories, resource count.
- `GET /resources` → list of resources (git/local) with fields:
  - git: `{ name, type, url, branch, searchPath?, searchPaths?, specialNotes? }`
  - local: `{ name, type, path, specialNotes? }`
- `PUT /config/model` → body `{ provider, model }` → `{ provider, model }`.
- `POST /config/resources` → add resource (git/local), validates via zod schemas & normalizes GitHub URLs.
- `DELETE /config/resources` → body `{ name }`.
- `POST /clear` → `{ cleared: number }`.

#### Providers
- `GET /providers` → `{ all: [{ id, models }], connected: string[] }`.

#### Q&A
- `POST /question` → body `{ question, resources?, quiet? }`
  - resolves resource list (if empty: all resources), loads collection, runs agent, returns:
  - `{ answer, model, resources, collection: { key, path } }`.
- `POST /question/stream` → SSE stream
  - `meta` event includes model/resources/collection info.
  - `text.delta`, `reasoning.delta`, `tool.updated`, `error`, `done`.

#### OpenCode Instance (legacy compatibility)
- `POST /opencode` → `{ resources?, quiet? }` returns `{ url, model, instanceId, resources, collection }`.
- `GET /opencode/instances` → `{ instances, count }`.
- `DELETE /opencode/instances` → `{ closed: number }`.
- `DELETE /opencode/:id` → `{ closed: true, instanceId }` or `{ error, instanceId }` w/ 404.

### Server Core Primitives

#### Config Service (`Config.load()`)
- Loads global config from `~/.config/btca/btca.config.jsonc`.
- Optionally merges project config `./btca.config.jsonc`.
- Supports JSONC (comments, trailing commas).
- Migrates legacy config `btca.json` → new config, adds defaults if missing.
- Resolved directories:
  - resources: `<dataDir>/resources`
  - collections: `<dataDir>/collections`
- Service API:
  - getters: `resources`, `model`, `provider`, `providerTimeoutMs`.
  - `getResource(name)`.
  - `updateModel(provider, model)` → persists.
  - `addResource(resource)` → persists (project config if exists).
  - `removeResource(name)` → persists or errors if resource exists only in global.
  - `clearResources()` → deletes resource + collection dirs.

#### Resources Service
- `Resources.create(config)` → `load(name, { quiet })`.
- Supports git and local resources.
- Git resources are cloned/updated into `resourcesDirectory`, optionally sparse checkout.
- Local resources map to existing directories.
- Returns `BtcaFsResource` with `getAbsoluteDirectoryPath()` and metadata.

#### Collections Service
- `Collections.create({ config, resources })` → `load({ resourceNames, quiet })`.
- Creates collection dir and symlinks resources by safe name.
- Emits `agentInstructions` block with notes and focus paths.
- Uses `Transaction.run` for metrics + context.

#### Agent Service
- `Agent.create(config)` exposes:
  - `ask({ collection, question })` → complete answer.
  - `askStream({ collection, question })` → AsyncIterable of agent events + model info.
  - `getOpencodeInstance({ collection })` → spawn OpenCode server, return URL + instanceId.
  - `listProviders()` → supported providers and connected provider IDs.
  - Instance management: `listInstances`, `closeInstance`, `closeAllInstances`.
- Uses `@opencode-ai/sdk` for legacy instance and `ai` SDK for direct answering.
- Validates provider auth via OpenCode auth store (`Auth`).

#### Agent Loop
- `AgentLoop.run()` and `AgentLoop.stream()`:
  - Uses AI SDK `streamText` with tools.
  - Tools: `read`, `grep`, `glob`, `list`.
  - Creates a system prompt with collection instructions.
  - Seeds context with directory listing of collection root.

#### Stream Service
- Converts `AgentLoop.AgentEvent` → SSE events in `StreamService.createSseStream`.
- Maintains tool state map by callID.
- Uses shared `stripUserQuestionFromStart` and `extractCoreQuestion` to remove echoed question.

#### Providers
- Registry of supported provider factories (Anthropic/OpenAI/etc + OpenCode Zen).
- Auth uses OpenCode auth storage (`~/.local/share/opencode/auth.json`).
- Model creation uses provider factory + API key.

#### Tools
- `read`: file contents with line numbers, truncation, attachments for images/PDFs.
- `grep`: regex search via `ripgrep`, capped results.
- `glob`: file matching via `ripgrep` file listing.
- `list`: directory listing.
- `sandbox`: path resolution + escape prevention.

#### Metrics & Context
- `Context` uses AsyncLocalStorage for requestId + transaction depth.
- `Transaction` wraps spans for logs and error tracking.
- `Metrics` logs JSON lines with requestId, quiet mode toggle.

### Shared (used by server)
- `@btca/shared/stream-filter`:
  - `stripUserQuestionFromStart`, `extractCoreQuestion`, `StreamingTagStripper`.

---

## Config Files & External Contracts

### `btca.config.jsonc`
- JSONC config (global + project).
- Fields: `provider`, `model`, `resources[]`, `dataDirectory`, `providerTimeoutMs`.
- Resource types:
  - git: `{ type, name, url, branch, searchPath?, searchPaths?, specialNotes? }`
  - local: `{ type, name, path, specialNotes? }`

### `btca.remote.config.jsonc`
- Remote mode config:
  - `{ project, model?, resources[] }` with git-only resources.

### Auth Files
- OpenCode auth: `~/.local/share/opencode/auth.json` (platform dependent).
- Remote auth: `~/.config/btca/remote-auth.json`.

---

## Key Compatibility Constraints for Rewrite
- All CLI commands, flags, outputs, exit codes should behave equivalently.
- Server routes/JSON shapes/SSE event schemas must remain unchanged.
- Maintain config migration behavior and JSONC parsing.
- Preserve tool output formats (line numbers, truncation messages, etc.).
- Preserve resource name validation + URL normalization semantics.

