# BTCA v2 Project Reference

Complete reference for BTCA v2 architecture, CLI commands, MCP tools, and data model.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [CLI Commands](#cli-commands)
3. [MCP Tools](#mcp-tools)
4. [Configuration Files](#configuration-files)
5. [Data Model](#data-model)
6. [Server API](#server-api)

---

## Architecture Overview

BTCA operates in two modes:

### Local Mode

- **Interface**: CLI (TUI or REPL)
- **Agent Location**: User's machine
- **Repo Storage**: Local filesystem (`.btca/` or `~/.local/share/btca/`)
- **Auth**: OpenCode auth system (user's API keys)
- **Cost**: Token cost through user's provider subscription

### Remote Mode

- **Interface**: Web app + MCP
- **Agent Location**: Daytona cloud sandbox
- **Repo Storage**: Cloud (cached per project)
- **Auth**: BTCA API key (subscription-based)
- **Cost**: $8/mo subscription

### Shared Components

Both modes use identical agent code in `apps/server`:

```
apps/server/
├── src/
│   ├── agent/
│   │   ├── loop.ts          # AI SDK streamText loop
│   │   ├── service.ts       # Agent service interface
│   │   └── types.ts
│   ├── tools/
│   │   ├── read.ts          # File reading
│   │   ├── grep.ts          # Regex search (in-memory)
│   │   ├── glob.ts          # File pattern matching (in-memory)
│   │   └── list.ts          # Directory listing
│   ├── providers/
│   │   ├── auth.ts          # OpenCode auth wrapper
│   │   ├── registry.ts      # Provider factories
│   │   └── model.ts         # Model instantiation
│   └── ...
```

---

## CLI Commands

### Global Options

All commands support:

- `--server <url>` - Use existing btca server URL
- `--port <port>` - Port for auto-started server

---

### Core Commands

#### `btca`

Launch interactive TUI (default command).

```bash
btca [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--no-tui` | Use REPL mode instead of TUI |

---

#### `btca init`

Initialize project configuration.

```bash
btca init [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `-f, --force` | Overwrite existing configuration |

**Behavior:**

- Interactive wizard for setup
- Creates `btca.config.jsonc` in current directory
- Updates `AGENTS.md` with usage instructions

---

#### `btca add <url>`

Add a git repository as a resource.

```bash
btca add <url> [options]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `url` | Yes | GitHub repository URL |

**Options:**
| Flag | Description |
|------|-------------|
| `-g, --global` | Add to global config instead of project |
| `-n, --name <name>` | Resource name (prompted if omitted) |
| `-b, --branch <branch>` | Branch to use (default: main) |
| `-s, --search-path <path>` | Subdirectory to search (repeatable) |
| `--notes <notes>` | Special notes for the agent |

**Examples:**

```bash
# Interactive wizard
btca add https://github.com/sveltejs/svelte.dev

# Fully specified (agent-friendly)
btca add https://github.com/sveltejs/svelte.dev \
  -n svelte \
  -b main \
  -s apps/svelte.dev/src/content \
  --notes "Focus on documentation content"

# Add to global config
btca add -g https://github.com/tj/commander.js
```

---

#### `btca remove <name>`

Remove a resource from configuration.

```bash
btca remove [name] [options]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `name` | No | Resource name (interactive selection if omitted) |

**Options:**
| Flag | Description |
|------|-------------|
| `-g, --global` | Remove from global config |

**Examples:**

```bash
# Interactive selection
btca remove

# Direct removal
btca remove svelte

# Remove from global
btca remove -g commander
```

---

#### `btca connect`

Configure AI provider and model.

```bash
btca connect [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `-g, --global` | Set in global config |
| `-p, --provider <id>` | Provider ID (e.g., anthropic, openai) |
| `-m, --model <id>` | Model ID (e.g., claude-sonnet-4-20250514) |

**Behavior:**

- If provider not authenticated with OpenCode: guides through auth flow
- If already authenticated: sets provider/model in config

**Examples:**

```bash
# Interactive setup
btca connect

# Direct configuration
btca connect -p anthropic -m claude-sonnet-4-20250514

# Set globally
btca connect -g -p openai -m gpt-4o
```

---

#### `btca ask`

Ask a one-shot question (non-interactive).

```bash
btca ask [options]
```

**Options:**
| Flag | Required | Description |
|------|----------|-------------|
| `-q, --question <text>` | Yes | The question to ask |
| `-r, --resource <name>` | No | Resources to query (repeatable) |

**Behavior:**

- Streams response to stdout
- Supports `@mentions` in question text (e.g., `@svelte`)
- Uses all resources if none specified

**Examples:**

```bash
# Ask about specific resource
btca ask -q "How do I create a store?" -r svelte

# Ask about multiple resources
btca ask -q "Compare routing in @svelte vs @svelteKit" -r svelte -r svelteKit

# Use @mentions
btca ask -q "How does @hono handle middleware?"
```

---

#### `btca serve`

Start standalone HTTP server.

```bash
btca serve [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `-p, --port <port>` | Port to listen on (default: 8080) |

---

#### `btca clear`

Clear all locally cloned resources.

```bash
btca clear
```

**Behavior:**

- Removes all cloned repos from data directory
- Returns count of cleared resources

---

### Remote Commands

All remote commands require prior authentication via `btca remote link`.

#### `btca remote link`

Authenticate with BTCA cloud service.

```bash
btca remote link
```

**Behavior:**

- Opens browser for OAuth flow
- Stores API key in `~/.config/btca/remote-auth.json`
- Validates key works

---

#### `btca remote add <url>`

Add resource to remote project and sync to cloud.

```bash
btca remote add <url> [options]
```

**Arguments & Options:** Same as `btca add`

**Behavior:**

- Creates/updates `btca.remote.config.jsonc`
- Syncs resource to cloud project

---

#### `btca remote sync`

Synchronize local config with cloud.

```bash
btca remote sync [options]
```

**Options:**
| Flag | Description |
|------|-------------|
| `--force` | Overwrite cloud on conflicts |

**Behavior:**

- Pull: resources in cloud but not local → add to local config
- Push: resources in local but not cloud → add to cloud
- Conflict: resource exists in both with different config → ERROR
  - Use `--force` to push local version
  - Or update local config to match cloud

---

#### `btca remote wake`

Pre-warm the cloud sandbox.

```bash
btca remote wake
```

**Behavior:**

- Starts sandbox if stopped
- Returns when sandbox is ready (~4 seconds)

---

#### `btca remote status`

Show cloud instance status.

```bash
btca remote status
```

**Output:**

- Sandbox state (running/stopped)
- Project name
- Resource count
- Last activity

---

#### `btca remote grab <threadId>`

Output full transcript of a cloud thread.

```bash
btca remote grab <threadId> [options]
```

**Arguments:**
| Argument | Required | Description |
|----------|----------|-------------|
| `threadId` | Yes | Thread ID from web app |

**Options:**
| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |
| `--markdown` | Output as markdown (default) |

---

#### `btca remote ask`

Ask a question via cloud sandbox.

```bash
btca remote ask [options]
```

**Options:** Same as `btca ask`

**Behavior:**

- Uses remote config for project context
- Hits cloud sandbox instead of local agent

---

## MCP Tools

MCP endpoint: `https://btca.dev/api/mcp`

Authentication: Bearer token (API key from web app)

---

### `listResources`

List available resources for the authenticated user.

**Parameters:** None

**Returns:**

```json
[
	{
		"name": "svelte",
		"displayName": "Svelte",
		"type": "git",
		"url": "https://github.com/sveltejs/svelte.dev",
		"branch": "main",
		"searchPath": "apps/svelte.dev",
		"specialNotes": "Focus on content directory"
	}
]
```

---

### `ask`

Ask a question about specific resources.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | Yes | The question to ask |
| `resources` | string[] | Yes | Resource names (from listResources) |
| `project` | string | No | Project name (default: "default" or from config) |

**Returns:**

```json
{
	"text": "The answer to your question..."
}
```

---

### `addResource`

Add a resource to the cloud project.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | GitHub repository URL |
| `name` | string | Yes | Resource name |
| `branch` | string | No | Branch (default: main) |
| `searchPaths` | string[] | No | Subdirectories to search |
| `notes` | string | No | Special notes for agent |

**Returns:**

```json
{
	"ok": true,
	"resource": {
		"name": "svelte",
		"url": "https://github.com/sveltejs/svelte.dev"
	}
}
```

---

### `sync`

Sync local config to cloud.

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config` | string | Yes | Full text of `btca.remote.config.jsonc` |

**Returns:**

```json
{
	"ok": true,
	"synced": ["svelte", "hono"],
	"errors": []
}
```

**Error Response:**

```json
{
	"ok": false,
	"errors": ["Resource 'svelte' has conflicting configuration"],
	"synced": []
}
```

---

## Configuration Files

### `btca.config.jsonc` (Local Mode)

Location: Project root or `~/.config/btca/btca.config.jsonc` (global)

```jsonc
{
	"$schema": "https://btca.dev/btca.schema.json",

	// Provider configuration (optional, prompted if missing)
	"provider": "anthropic",
	"model": "claude-sonnet-4-20250514",

	// Where to store cloned repos (optional)
	// "local" = .btca/ in project, "global" = ~/.local/share/btca/
	"dataDirectory": ".btca",

	// Resources available in this project
	"resources": [
		{
			"type": "git",
			"name": "svelte",
			"url": "https://github.com/sveltejs/svelte.dev",
			"branch": "main",
			"searchPaths": ["apps/svelte.dev"],
			"specialNotes": "Focus on content directory for documentation"
		},
		{
			"type": "local",
			"name": "internal-docs",
			"path": "./docs",
			"specialNotes": "Internal API documentation"
		}
	]
}
```

**Supported Providers (Local Mode):**

- `opencode` — API key required
- `openrouter` — API key required
- `openai` — OAuth only
- `google` — API key or OAuth
- `anthropic` — API key required

Authenticate with OpenCode:

```bash
opencode auth --provider <provider>
```

If a provider is missing, open an issue to request support:

```
https://github.com/davis7dotsh/better-context/issues
```

**Config Merging:**

- Global config loaded first
- Project config merged on top
- Project values override global on conflict
- Resources combined (project version wins on name conflict)

---

### `btca.remote.config.jsonc` (Remote Mode)

Location: Project root

```jsonc
{
	"$schema": "https://btca.dev/btca.remote.schema.json",

	// Project name (required, unique identifier)
	"project": "my-webapp",

	// Model selection (from preset list)
	"model": "claude-sonnet",

	// Resources for this project
	"resources": [
		{
			"type": "git",
			"name": "svelte",
			"url": "https://github.com/sveltejs/svelte.dev",
			"branch": "main",
			"searchPaths": ["apps/svelte.dev"],
			"specialNotes": "Focus on content directory"
		}
	]
}
```

**Available Models:**
| Key | Model |
|-----|-------|
| `claude-haiku` | Claude Haiku |

---

### `~/.config/btca/remote-auth.json`

Stores remote authentication.

```json
{
	"apiKey": "btca_xxxxxxxxxxxx",
	"linkedAt": 1706000000000
}
```

---

## Data Model

### Convex Schema (Remote/Cloud)

#### `projects`

| Field        | Type            | Description                           |
| ------------ | --------------- | ------------------------------------- |
| `instanceId` | Id<"instances"> | Reference to user instance            |
| `name`       | string          | Project name (unique per instance)    |
| `model`      | string          | Selected model key                    |
| `isDefault`  | boolean         | True for auto-created default project |
| `createdAt`  | number          | Timestamp                             |

**Indexes:** `by_instance`, `by_name`

---

#### `instances`

| Field                | Type    | Description                      |
| -------------------- | ------- | -------------------------------- |
| `clerkId`            | string  | Clerk user ID                    |
| `sandboxId`          | string? | Daytona sandbox ID               |
| `state`              | enum    | Instance state                   |
| `serverUrl`          | string? | Running server URL               |
| `subscriptionPlan`   | enum?   | pro, free, none                  |
| `subscriptionStatus` | enum?   | active, trialing, canceled, none |
| `storageUsedBytes`   | number? | Storage usage                    |
| `createdAt`          | number  | Timestamp                        |

**States:** `unprovisioned`, `provisioning`, `stopped`, `starting`, `running`, `stopping`, `updating`, `error`

---

#### `threads`

| Field            | Type            | Description             |
| ---------------- | --------------- | ----------------------- |
| `instanceId`     | Id<"instances"> | Reference to instance   |
| `projectId`      | Id<"projects">? | Reference to project    |
| `title`          | string?         | Thread title            |
| `createdAt`      | number          | Timestamp               |
| `lastActivityAt` | number          | Last activity timestamp |

---

#### `messages`

| Field       | Type             | Description              |
| ----------- | ---------------- | ------------------------ |
| `threadId`  | Id<"threads">    | Reference to thread      |
| `role`      | enum             | user, assistant, system  |
| `content`   | string \| chunks | Message content          |
| `resources` | string[]?        | Resources used           |
| `canceled`  | boolean?         | If response was canceled |
| `createdAt` | number           | Timestamp                |

---

#### `userResources`

| Field          | Type            | Description           |
| -------------- | --------------- | --------------------- |
| `instanceId`   | Id<"instances"> | Reference to instance |
| `projectId`    | Id<"projects">? | Reference to project  |
| `name`         | string          | Resource name         |
| `type`         | literal         | "git"                 |
| `url`          | string          | Repository URL        |
| `branch`       | string          | Branch name           |
| `searchPath`   | string?         | Subdirectory path     |
| `specialNotes` | string?         | Notes for agent       |
| `createdAt`    | number          | Timestamp             |

---

#### `cachedResources`

| Field        | Type            | Description           |
| ------------ | --------------- | --------------------- |
| `instanceId` | Id<"instances"> | Reference to instance |
| `projectId`  | Id<"projects">? | Reference to project  |
| `name`       | string          | Resource name         |
| `url`        | string          | Repository URL        |
| `branch`     | string          | Branch name           |
| `sizeBytes`  | number?         | Cache size            |
| `cachedAt`   | number          | When cached           |
| `lastUsedAt` | number          | Last access time      |

---

#### `mcpQuestions`

| Field       | Type           | Description          |
| ----------- | -------------- | -------------------- |
| `projectId` | Id<"projects"> | Reference to project |
| `question`  | string         | Question asked       |
| `resources` | string[]       | Resources queried    |
| `answer`    | string         | Response text        |
| `createdAt` | number         | Timestamp            |

---

#### `apiKeys`

| Field        | Type            | Description            |
| ------------ | --------------- | ---------------------- |
| `instanceId` | Id<"instances"> | Reference to instance  |
| `name`       | string          | Key name               |
| `keyHash`    | string          | Hashed key             |
| `keyPrefix`  | string          | Key prefix for display |
| `createdAt`  | number          | Timestamp              |
| `lastUsedAt` | number?         | Last use time          |
| `revokedAt`  | number?         | Revocation time        |
| `usageCount` | number?         | Usage counter          |

---

#### `globalResources`

| Field          | Type    | Description           |
| -------------- | ------- | --------------------- |
| `name`         | string  | Resource name         |
| `displayName`  | string  | Display name          |
| `type`         | literal | "git"                 |
| `url`          | string  | Repository URL        |
| `branch`       | string  | Branch name           |
| `searchPath`   | string? | Subdirectory path     |
| `specialNotes` | string? | Notes for agent       |
| `isActive`     | boolean | If available to users |

---

## Server API

Base URL: `http://localhost:<port>` (local) or sandbox URL (remote)

### Endpoints

#### `GET /`

Health check.

**Response:** `{ "status": "ok" }`

---

#### `GET /config`

Get current configuration.

**Response:**

```json
{
	"provider": "anthropic",
	"model": "claude-sonnet-4-20250514",
	"dataDirectory": ".btca"
}
```

---

#### `GET /resources`

List all configured resources.

**Response:**

```json
[
	{
		"name": "svelte",
		"type": "git",
		"url": "https://github.com/sveltejs/svelte.dev",
		"branch": "main"
	}
]
```

---

#### `GET /providers`

List available AI providers.

**Response:**

```json
{
  "all": [
    { "id": "anthropic", "models": {...} },
    { "id": "openai", "models": {...} }
  ],
  "connected": ["anthropic"]
}
```

---

#### `POST /question`

Ask a question (non-streaming).

**Request:**

```json
{
	"question": "How do I create a store?",
	"resources": ["svelte"]
}
```

**Response:**

```json
{
	"answer": "To create a store in Svelte...",
	"model": {
		"provider": "anthropic",
		"model": "claude-sonnet-4-20250514"
	}
}
```

---

#### `POST /question/stream`

Ask a question (SSE streaming).

**Request:** Same as `/question`

**Response:** Server-Sent Events stream

---

#### `PUT /config/model`

Update model configuration.

**Request:**

```json
{
	"provider": "anthropic",
	"model": "claude-sonnet-4-20250514"
}
```

---

#### `POST /config/resources`

Add a resource.

**Request:**

```json
{
	"type": "git",
	"name": "hono",
	"url": "https://github.com/honojs/website",
	"branch": "main",
	"searchPath": "docs"
}
```

---

#### `DELETE /config/resources`

Remove a resource.

**Request:**

```json
{
	"name": "hono"
}
```

---

#### `POST /clear`

Clear all cloned resources.

**Response:**

```json
{
	"cleared": 5
}
```
