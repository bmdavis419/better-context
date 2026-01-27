# btca-sandbox

Spin up a Daytona sandbox with btca and opencode pre-installed.

## Prerequisites

### Environment Variables

Set the following environment variables before running:

```bash
# Required
export DAYTONA_API_KEY="your-daytona-api-key"
export OPENCODE_API_KEY="your-opencode-api-key"

# Optional
export DAYTONA_API_URL="https://app.daytona.io/api"  # defaults to this
```

- **DAYTONA_API_KEY**: Get from your [Daytona dashboard](https://app.daytona.io)
- **OPENCODE_API_KEY**: Get from your [OpenCode workspace settings](https://opencode.ai)

## Usage

### 1. Create the Snapshot (one-time setup)

First, create a snapshot with bun, btca, and opencode pre-installed:

```bash
bun snapshot
```

This builds a Debian-based image with:

- bun runtime
- btca CLI (globally installed)
- opencode CLI (globally installed)

The snapshot is named `btca-sandbox` and only needs to be created once. Subsequent sandbox startups will be much faster.

### 2. Run a Sandbox

Start a sandbox from the snapshot:

```bash
bun sandbox
```

This will:

1. Create a sandbox from the pre-built snapshot
2. Upload the default btca configuration
3. Start the btca server on port 3000
4. Output the public URL for the server

Example output:

```
Creating sandbox from snapshot: btca-sandbox
Sandbox created with ID: abc123...
bun version: 1.3.5
btca version: 1.0.21
Setting up btca configuration...
Starting btca server...
Server is healthy!

========================================
BTCA Sandbox is running!
========================================
Sandbox ID: abc123...
Server URL: https://3000-abc123.proxy.daytona.works
(Public - no auth token required)
========================================

Press Ctrl+C to stop the sandbox and clean up.
```

### 3. Use the Server

The btca server exposes these endpoints:

```bash
# Health check
curl https://3000-{sandbox-id}.proxy.daytona.works/

# Get config
curl https://3000-{sandbox-id}.proxy.daytona.works/config

# List resources
curl https://3000-{sandbox-id}.proxy.daytona.works/resources

# Ask a question
curl -X POST https://3000-{sandbox-id}.proxy.daytona.works/question \
  -H "Content-Type: application/json" \
  -d '{"question": "How do I create a sandbox?", "resources": ["daytona"]}'

# Ask with streaming
curl -X POST https://3000-{sandbox-id}.proxy.daytona.works/question/stream \
  -H "Content-Type: application/json" \
  -d '{"question": "Explain Svelte reactivity", "resources": ["svelte"]}'
```

### 4. Cleanup

Press `Ctrl+C` to stop the sandbox. It will automatically be deleted.

## Default Configuration

The sandbox comes pre-configured with these resources:

- **daytona**: The full Daytona codebase
- **svelte**: Svelte documentation website

You can modify the configuration by editing `DEFAULT_BTCA_CONFIG` in `src/index.ts`.

## Development

```bash
# Type check
bun run check:sandbox

# Format
bun run format:sandbox
```

## Architecture

```
apps/sandbox/
├── src/
│   ├── index.ts      # Main entry - creates sandbox from snapshot
│   └── snapshot.ts   # Creates the btca-sandbox snapshot
├── package.json
└── README.md
```

The workflow is:

1. `snapshot.ts` creates a Daytona snapshot with all dependencies baked in
2. `index.ts` creates sandboxes from that snapshot for fast startup
3. Each sandbox runs btca serve and exposes it via Daytona's preview URLs

## Sandbox File System Structure

Each sandbox has a specific directory structure for storing configurations and cached resources.

### Current Structure (Default Project Only)

For backward compatibility, the "default" project uses the root-level config:

```
/root/
├── btca.config.jsonc              # Default project configuration
└── .local/share/btca/
    └── resources/                 # Default project's cached git repos
        ├── svelte/                # Cloned svelte repo
        ├── daytona/               # Cloned daytona repo
        └── ...
```

### Project-Aware Structure (Future)

When projects are fully implemented, each project will have its own isolated directory:

```
/root/
├── btca.config.jsonc              # Default project config (backward compat)
├── .local/share/btca/
│   ├── resources/                 # Default project resources
│   │   ├── svelte/
│   │   └── daytona/
│   └── projects/                  # Project-specific directories
│       ├── my-project/
│       │   ├── btca.config.jsonc  # Project-specific config
│       │   └── resources/         # Project-specific cached repos
│       │       └── svelte/        # Can be different repo than default's svelte
│       └── another-project/
│           ├── btca.config.jsonc
│           └── resources/
│               └── react/
```

### Key Design Decisions

1. **Project Isolation**: Each project has its own `resources/` directory. This allows
   different projects to have resources with the same name (e.g., "svelte") pointing to
   different repos without conflict.

2. **Backward Compatibility**: The "default" project uses the root-level config at
   `/root/btca.config.jsonc` and resources at `/root/.local/share/btca/resources/`.
   This ensures existing MCP integrations continue working without changes.

3. **Convex vs Sandbox Separation**:
   - **Projects and threads** are managed in Convex (database)
   - **The sandbox** is ephemeral and stateless from a conversation perspective
   - When answering a question, Convex passes the project name to the sandbox
   - The sandbox uses the project name to determine which config/resources directory to use

4. **Config Upload Flow**: When waking a sandbox or syncing resources, Convex:
   - Generates the `btca.config.jsonc` for each project
   - Uploads it to the appropriate project directory
   - The btca server reads the config from the correct location based on the `project` parameter

### Request Flow

1. MCP client calls `ask` with optional `project` parameter
2. Convex validates the request and wakes the sandbox if needed
3. Convex forwards the request to the sandbox's `/question` endpoint with the project name
4. The sandbox's btca server:
   - Uses `/root/btca.config.jsonc` if project is "default" or not specified
   - Uses `/root/.local/share/btca/projects/{project}/btca.config.jsonc` otherwise
5. Resources are cloned/cached to the appropriate project's `resources/` directory

### Implementation Status

- [x] **Phase 3**: Schema supports projects, MCP accepts `project` parameter
- [ ] **Phase 5**: Sandbox btca server reads project-specific configs
- [ ] **Phase 5**: Resource syncing creates project-specific directories
