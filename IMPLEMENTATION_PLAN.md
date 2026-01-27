# BTCA v2 Implementation Plan

This document outlines the complete implementation plan for the BTCA v2 refactor, introducing local and remote modes with a unified agent core.

---

## Overview

BTCA v2 introduces two distinct operational modes:

- **Local Mode**: CLI/TUI running on the user's machine, repos cloned locally, using their own API keys
- **Remote Mode**: Cloud service with web app and MCP, repos cached in the cloud, subscription-based

Both modes share the same agent core, which moves from spawning OpenCode instances to a custom AI SDK loop with opencode's auth system.

---

## Phase 1+2: Auth, Provider & Agent Core

### Goals

- Remove OpenCode as the agent runner (keep only for auth)
- Build custom AI SDK agent loop with 4 tools (read, grep, glob, list)
- Support all 40+ providers through opencode's Auth module
- Make the agent implementation identical for local and remote

### 1. Add OpenCode as Server Dependency

Update `apps/server/package.json` to include opencode for auth only:

```json
{
	"dependencies": {
		"opencode": "^x.x.x",
		"ai": "^5.x",
		"@ai-sdk/anthropic": "^x.x.x",
		"@ai-sdk/openai": "^x.x.x"
		// ... other providers as needed
	}
}
```

### 2. Provider Abstraction Layer

Create `apps/server/src/providers/` with:

- `auth.ts` - Wrapper around opencode's Auth module
  - `getCredentials(providerId)` - Get stored credentials
  - `isAuthenticated(providerId)` - Check if provider is authed
- `registry.ts` - Provider factory registry
  - Map of provider IDs to AI SDK factory functions
  - Support for: anthropic, openai, google, azure, groq, mistral, xai, etc.
- `model.ts` - Model instantiation
  - `getModel(providerId, modelId)` - Create AI SDK model with auth
  - Handle both API key and OAuth auth types

### 3. Ripgrep Binary Management

Create `apps/server/src/tools/ripgrep.ts`:

- Check if `rg` exists in PATH
- If not, download pre-built binary from GitHub releases
- Support platforms: darwin-arm64, darwin-x64, linux-arm64, linux-x64, windows-x64
- Cache binary in `~/.local/share/btca/bin/`
- Make executable (chmod 755)

### 4. Agent Tools Implementation

Create `apps/server/src/tools/` with sandboxed implementations:

**`read.ts`**

- Parameters: `{ path: string, offset?: number, limit?: number }`
- Read file contents with line numbers
- Truncation: max 2000 lines, 50KB, 2000 chars per line
- Handle images/PDFs as base64 attachments
- Detect binary files (null byte check)
- Path validation: must be within collections directory

**`grep.ts`**

- Parameters: `{ pattern: string, path?: string, include?: string }`
- Execute ripgrep subprocess
- Parse output format: `filepath|lineNum|lineText`
- Sort by modification time
- Max 100 results
- Path validation: search path must be within collections directory

**`glob.ts`**

- Parameters: `{ pattern: string, path?: string }`
- Use ripgrep's `--files` with glob pattern
- Sort by modification time (most recent first)
- Max 100 results
- Path validation: search path must be within collections directory

**`list.ts`**

- Parameters: `{ path: string }`
- List directory contents
- Return file/directory names with types
- Path validation: must be within collections directory

### 5. Path Sandboxing

All tools must validate paths stay within the collections directory:

- Resolve all paths to absolute
- Check that resolved path starts with collections base path
- Reject paths with `..` that escape
- Handle symlinks: resolve and validate target

### 6. Custom Agent Loop

Create `apps/server/src/agent/loop.ts`:

- Use AI SDK's `streamText` with tools
- System prompt: expert at searching collections, restricted to read-only tools
- Initial context: `ls` of collections directory
- Tool execution with path sandboxing
- Stream events back to caller
- Handle tool calls, text responses, errors

### 7. Agent Service Refactor

Update `apps/server/src/agent/service.ts`:

- Remove OpenCode SDK dependency for agent execution
- Keep provider validation logic
- Use new custom agent loop
- Maintain same external API (`ask`, `askStream`)

### 8. Testing

- Unit tests for each tool
- Integration test: full agent loop with mock provider
- Path sandboxing tests (escape attempts)
- Provider auth tests

---

## Phase 3: Database & Migration Prep

### Goals

- Add project support to database schema
- Migrate existing users to "default" project
- Backward-compatible API changes

### 1. Schema Changes

Add to `apps/web/src/convex/schema.ts`:

**New `projects` table:**

- `instanceId` - Reference to instance
- `name` - Project name (unique per instance)
- `model` - Selected model key
- `createdAt`
- `isDefault` - Boolean, true for auto-created default project

**Add `projectId` to existing tables:**

- `threads` - Add optional `projectId` field
- `userResources` - Add optional `projectId` field
- `cachedResources` - Add optional `projectId` field

**New `mcpQuestions` table:**

- `projectId` - Reference to project
- `question` - The question asked
- `resources` - Array of resource names used
- `answer` - The response
- `createdAt`

### 2. Migration Script

Create Convex migration to:

1. For each existing instance:
   - Create a "default" project with `isDefault: true`
   - Update all threads to reference default project
   - Update all userResources to reference default project
   - Update all cachedResources to reference default project

2. Ensure migration is idempotent (can run multiple times safely)

### 3. API Changes

Update Convex actions/queries:

- `mcp.listResources` - Accept optional `projectId`, default to default project
- `mcp.ask` - Accept optional `projectId`, default to default project
- Add `projects.list` - List projects for instance
- Add `projects.create` - Create new project
- Add `projects.get` - Get project by name
- Add `mcpQuestions.list` - List questions for project

### 4. Backward Compatibility

MCP commands without project specified:

- Look for `btca.remote.config.jsonc` in working directory
- If found, use project name from config
- If not found, use "default" project

---

## Phase 4: Local Mode

### Goals

- New config schema with provider/model
- Simplified CLI commands
- TUI for interactive chat
- `btca ask` for agent-to-agent context

### 1. Config Schema

**`btca.config.jsonc` (project-level):**

```jsonc
{
	"$schema": "https://btca.dev/btca.schema.json",
	"provider": "anthropic", // Optional, prompted if missing
	"model": "claude-sonnet-4-20250514", // Optional, prompted if missing
	"dataDirectory": ".btca", // Optional, default: .btca
	"resources": [
		{
			"type": "git",
			"name": "svelte",
			"url": "https://github.com/sveltejs/svelte.dev",
			"branch": "main",
			"searchPaths": ["apps/svelte.dev"],
			"specialNotes": "Focus on content directory"
		},
		{
			"type": "local",
			"name": "myDocs",
			"path": "./docs",
			"specialNotes": "Internal documentation"
		}
	]
}
```

**Global config (`~/.config/btca/btca.config.jsonc`):**

- Same schema as project config
- Merged with project config (project wins on conflict)
- Resources from both are combined

### 2. Config Merging Logic

When loading config:

1. Load global config if exists
2. Load project config if exists (from cwd or parent directories)
3. Merge: project provider/model override global
4. Merge: combine resources, project version wins on name conflict

### 3. CLI Commands

**`btca` (default)**

- Launch TUI for interactive chat
- Options: `--no-tui` for REPL mode

**`btca init`**

- Interactive setup wizard
- Prompts: local vs global storage, initial resources
- Creates `btca.config.jsonc`
- Updates `AGENTS.md` with usage instructions

**`btca add <url>`**

- Add a git resource
- Options:
  - `-g, --global` - Add to global config
  - `-n, --name <name>` - Resource name (prompted if not provided)
  - `-b, --branch <branch>` - Branch (default: main)
  - `-s, --search-path <path>` - Search path within repo (can specify multiple)
  - `--notes <notes>` - Special notes for the agent
- Without flags: interactive wizard

**`btca remove <name>`**

- Remove a resource by name
- Options:
  - `-g, --global` - Remove from global config
- If name not provided: interactive selection

**`btca connect`**

- Configure provider/model
- If already authed with opencode: just set in config
- If not authed: guide through opencode auth flow, then set
- Options:
  - `-g, --global` - Set in global config
  - `-p, --provider <id>` - Provider ID
  - `-m, --model <id>` - Model ID

**`btca ask`**

- One-shot question with streaming response
- Options:
  - `-q, --question <text>` - Required
  - `-r, --resource <name>` - Resources to query (multiple allowed)
- Supports `@mentions` in question text

**`btca serve`**

- Start standalone server
- Options:
  - `-p, --port <port>` - Port (default: 8080)

**`btca clear`**

- Clear locally cloned resources
- Returns count of cleared resources

### 4. TUI Implementation

Update existing TUI to:

- Use new agent loop (not OpenCode)
- Show streaming responses
- Resource selection
- Model/provider display

---

## Phase 5: Remote Mode

### Goals

- Remote config schema
- CLI commands for remote operations
- MCP commands with project support
- Web app project system

### 1. Remote Config Schema

**`btca.remote.config.jsonc` (project-level):**

```jsonc
{
	"$schema": "https://btca.dev/btca.remote.schema.json",
	"project": "my-project", // Required, unique identifier
	"model": "claude-sonnet", // From preset list
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

**Available models (preset list):**

- `claude-sonnet` - Claude Sonnet (default)
- `claude-haiku` - Claude Haiku (faster, cheaper)
- `gpt-4o` - GPT-4o
- `gpt-4o-mini` - GPT-4o Mini

### 2. Auth Storage

**`~/.config/btca/remote-auth.json`:**

```json
{
	"apiKey": "btca_xxxx...",
	"linkedAt": 1234567890
}
```

### 3. CLI Commands

**`btca remote link`**

- Authenticate with remote instance
- Opens browser for OAuth flow
- Stores API key in `~/.config/btca/remote-auth.json`
- Validates key works

**`btca remote add <url>`**

- Add resource to remote config and sync to cloud
- Options: same as `btca add`
- Creates/updates `btca.remote.config.jsonc`
- Syncs resource to cloud project

**`btca remote sync`**

- Sync local config with cloud
- Pull: resources in cloud but not local → add to local config
- Push: resources in local but not cloud → add to cloud
- Conflict handling:
  - If resource exists in both with different config → ERROR
  - User must either `--force` to push local, or update local to match
- Options:
  - `--force` - Push local config, overwrite cloud on conflicts

**`btca remote wake`**

- Pre-warm the cloud sandbox
- Returns when sandbox is ready
- Useful before starting a session

**`btca remote status`**

- Show sandbox status (awake/asleep)
- Show project info
- Show resource count

**`btca remote grab <threadId>`**

- Output full transcript of a thread
- Formatted for easy copy/paste to agents
- Options:
  - `--json` - Output as JSON
  - `--markdown` - Output as markdown (default)

**`btca remote ask`**

- Same as `btca ask` but hits cloud sandbox
- Options: same as `btca ask`
- Uses remote config for project context

### 4. MCP Commands

**`listResources`** (existing, updated)

- Now scoped to project
- Uses project from config or "default"

**`ask`** (existing, updated)

- Parameters: `{ question: string, resources: string[], project?: string }`
- Project optional, defaults to "default" or config value
- Records question/answer in `mcpQuestions` table

**`addResource`** (new)

- Parameters: `{ url: string, name: string, branch?: string, searchPaths?: string[], notes?: string }`
- Adds resource to cloud project
- Same as `btca remote add` over MCP

**`sync`** (new)

- Parameters: `{ config: string }` - Full text of local `btca.remote.config.jsonc`
- Parses config, validates, syncs to cloud
- Returns: `{ ok: boolean, errors?: string[], synced: string[] }`
- Should be called when agent tries to use resource that's not in cloud

### 5. Web App Updates

**Project Selector:**

- Dropdown in header to switch projects
- "default" project always exists
- Create new project button

**Project View:**

- Resources tab: list/add/remove resources
- Threads tab: conversation threads for this project
- Questions tab: MCP questions asked for this project
- Settings tab: model selection, project name

**Questions Tab:**

- Shows questions asked via MCP
- Question text, resources used, answer, timestamp
- Useful for seeing what agents are asking

---

## Migration Strategy

### Remote Users (Existing)

**Automatic migration on first request after update:**

1. Check if user has a "default" project
2. If not:
   - Create "default" project with `isDefault: true`
   - Move all existing threads → default project
   - Move all existing userResources → default project
   - Move all existing cachedResources → default project

**MCP backward compatibility:**

- Commands without `project` parameter use "default" project
- Existing MCP integrations continue working unchanged
- New integrations can specify project

### Local Users (Existing)

**Config compatibility:**

- Existing `btca.config.jsonc` files work unchanged
- `provider` and `model` fields are optional
- If missing, user is prompted on first `btca ask` or TUI launch
- `btca connect` command to set provider/model

**Behavior changes:**

- `btca chat` command removed (was OpenCode TUI)
- `btca config model` and `btca config resources` removed
- Use `btca add`, `btca remove`, `btca connect` instead

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        BTCA v2 Architecture                      │
└─────────────────────────────────────────────────────────────────┘

LOCAL MODE                              REMOTE MODE
┌─────────────────┐                    ┌─────────────────┐
│   btca CLI      │                    │   Web App       │
│   - add/remove  │                    │   - Projects    │
│   - connect     │                    │   - Threads     │
│   - ask         │                    │   - Questions   │
│   - TUI         │                    │   - Resources   │
└────────┬────────┘                    └────────┬────────┘
         │                                      │
         │ HTTP                                 │ Convex
         ▼                                      ▼
┌─────────────────┐                    ┌─────────────────┐
│  btca-server    │                    │   Convex DB     │
│  (local)        │                    │   - projects    │
│                 │                    │   - threads     │
│  ┌───────────┐  │                    │   - messages    │
│  │ Agent     │  │                    │   - resources   │
│  │ - read    │  │                    └────────┬────────┘
│  │ - grep    │  │                             │
│  │ - glob    │  │                             │ HTTP
│  │ - list    │  │                             ▼
│  └───────────┘  │                    ┌─────────────────┐
│                 │                    │  Daytona        │
│  ┌───────────┐  │                    │  Sandbox        │
│  │ Providers │  │                    │                 │
│  │ (AI SDK)  │  │                    │  ┌───────────┐  │
│  └───────────┘  │                    │  │ btca-     │  │
│                 │                    │  │ server    │  │
│  ┌───────────┐  │                    │  │ (same!)   │  │
│  │ OpenCode  │  │                    │  └───────────┘  │
│  │ Auth      │  │                    │                 │
│  └───────────┘  │                    └─────────────────┘
└─────────────────┘                             │
         │                                      │
         │                                      │ MCP
         ▼                                      ▼
┌─────────────────┐                    ┌─────────────────┐
│  Local Repos    │                    │  MCP Clients    │
│  (.btca/)       │                    │  (Cursor, etc)  │
└─────────────────┘                    └─────────────────┘


SHARED COMPONENTS:
┌─────────────────────────────────────────────────────────────────┐
│  apps/server/src/agent/                                          │
│  - loop.ts        (AI SDK streamText with tools)                │
│  - tools/         (read, grep, glob, list)                      │
│  - providers/     (auth wrapper, model factory)                 │
│                                                                  │
│  Same code runs locally AND in cloud sandbox                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Success Criteria

### Phase 1+2 Complete When:

- [x] Can authenticate with any provider via opencode Auth
- [x] Custom agent loop answers questions using 4 tools
- [x] All tools respect path sandboxing
- [x] Ripgrep downloads automatically if not installed
- [x] Existing `btca ask` command works with new agent

### Phase 3 Complete When:

- [x] Projects table exists in Convex
- [x] Migration script moves existing data to "default" project
- [x] MCP commands work with and without project parameter
- [x] No breaking changes for existing MCP users

### Phase 4 Complete When:

- [x] `btca add`, `btca remove`, `btca connect` commands work
- [x] Config merging (global + project) works correctly
- [x] TUI launches and uses new agent
- [x] Provider/model prompting works when not configured

### Phase 5 Complete When:

- [x] `btca remote link` authenticates successfully
- [x] `btca remote sync` handles conflicts correctly
- [x] MCP `addResource` and `sync` commands work
- [x] Web app shows projects with resources/threads/questions
- [x] `btca remote grab` outputs thread transcripts
- [x] Web app shows projects with resources/threads/questions
