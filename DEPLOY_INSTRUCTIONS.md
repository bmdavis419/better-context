# BTCA v2 Deploy Instructions

This document covers the deployment steps for the Phase 3+ database changes (projects support and remote mode).

---

## ⚠️ CRITICAL: Pre-Deploy Code Changes

Before deploying, ensure these development overrides are reverted:

### CLI Remote URL

In `apps/cli/src/client/remote.ts`, change the `DEFAULT_REMOTE_URL` back to production:

```typescript
// Change FROM (development):
const DEFAULT_REMOTE_URL = 'http://localhost:5173';

// Change TO (production):
const DEFAULT_REMOTE_URL = 'https://btca.dev';
```

---

## Pre-Deploy Checklist

- [ ] Backup production Convex database (optional but recommended)
- [ ] Ensure all schema changes are committed
- [ ] Test migration in dev environment first

---

## Schema Changes Overview

Phase 3 introduces:

1. **New `projects` table** - Each instance can have multiple projects
2. **New `mcpQuestions` table** - Records MCP questions/answers per project
3. **Added `projectId`** (optional) to `threads`, `userResources`, `cachedResources`

These changes are **backward compatible** - the `projectId` fields are optional, and the MCP API accepts an optional `project` parameter that defaults to "default".

---

## Deployment Steps

### 1. Deploy Schema Changes

The schema changes will be applied automatically when you deploy to Convex:

```bash
# For development
cd apps/web
bunx convex dev

# For production
cd apps/web
bunx convex deploy
```

Convex will:

- Add the new `projects` and `mcpQuestions` tables
- Add the optional `projectId` field to existing tables
- Add new indexes
- Install the migrations component

**No data loss** - existing records simply won't have a `projectId` set yet.

### 2. Run the Migration

After the schema is deployed, run the migration using the Convex migrations component.

#### Option A: Run All Migrations via CLI (Recommended)

Run all migrations in sequence with a single command:

```bash
# For development
cd apps/web
bunx convex run migrations:runAll

# For production
cd apps/web
bunx convex run migrations:runAll --prod
```

This will:

1. Migrate all `threads` without a projectId → assigns to default project (creates if needed)
2. Migrate all `userResources` without a projectId → assigns to default project
3. Migrate all `cachedResources` without a projectId → assigns to default project

The migration component will:

- Skip records already migrated
- Resume from where it left off if interrupted
- Run in batches asynchronously

#### Option B: Run Individual Migrations

If you prefer more control, run each migration individually:

```bash
# 1. Migrate threads
bunx convex run migrations:run '{fn: "migrations:migrateThreadsToProject"}'

# 2. Migrate user resources
bunx convex run migrations:run '{fn: "migrations:migrateUserResourcesToProject"}'

# 3. Migrate cached resources
bunx convex run migrations:run '{fn: "migrations:migrateCachedResourcesToProject"}'
```

Add `--prod` flag for production.

#### Option C: Dry Run First

Test a migration without committing changes:

```bash
bunx convex run migrations:run '{fn: "migrations:migrateThreadsToProject", dryRun: true}'
```

### 3. Monitor Migration Status

#### Check Overall Status

```bash
bunx convex run internal.migrations:getMigrationStatus
```

This shows:

- Total instances
- Total projects
- Records without projectId (threads, userResources, cachedResources)
- Whether migration is complete

#### Watch Migration Progress (Live)

```bash
bunx convex run --component migrations lib:getStatus --watch
```

#### Check Instances Without Default Project

```bash
bunx convex run internal.migrations:getInstancesWithoutDefaultProject
```

### 4. Verify Deployment

After migration, verify:

1. **MCP commands still work** - Test `listResources` and `ask` without the `project` parameter
2. **Web app loads** - Existing threads should still be visible
3. **New projects can be created** - Test creating a project via the API

---

## Migration Component Operations

### Stop a Running Migration

```bash
bunx convex run --component migrations lib:cancel '{name: "migrations:migrateThreadsToProject"}'
```

### Restart a Migration from Beginning

```bash
bunx convex run migrations:run '{fn: "migrations:migrateThreadsToProject", cursor: null}'
```

### Create Missing Default Projects Only

If you just want to create default projects without migrating records:

```bash
bunx convex run internal.migrations:createMissingDefaultProjects
```

---

## Rollback Plan

If issues occur:

1. **Schema rollback is not needed** - The new fields are optional and don't break existing functionality
2. **If migration caused issues** - The `projectId` fields can be set back to `undefined` if needed (though this shouldn't be necessary)

---

## Post-Deploy Notes

### Sandbox Changes (Future - Phase 5)

The sandbox currently ignores the `project` parameter passed in requests. In Phase 5, the sandbox will:

1. Create project-specific directories: `/root/.local/share/btca/projects/{project-name}/`
2. Store project-specific configs and resources separately
3. Allow different projects to have resources with the same name pointing to different repos

See `apps/sandbox/README.md` for the planned file system structure.

### MCP API Changes

The MCP API now accepts an optional `project` parameter:

```typescript
// Before (still works)
ask({ apiKey, question, resources });

// After (new)
ask({ apiKey, question, resources, project: 'my-project' });
```

If `project` is not provided, it defaults to "default".

---

## Troubleshooting

### Migration seems stuck

The migrations component tracks progress and can resume. Check status with:

```bash
bunx convex run --component migrations lib:getStatus --watch
```

If needed, cancel and restart:

```bash
bunx convex run --component migrations lib:cancel '{name: "migrations:migrateThreadsToProject"}'
bunx convex run migrations:run '{fn: "migrations:migrateThreadsToProject", cursor: null}'
```

### Records still show no projectId after migration

The migrations component processes in batches. Check if migration is still running:

```bash
bunx convex run --component migrations lib:getStatus
```

If status shows completed but records remain, the customRange filter may need adjustment. Re-run the migration to catch any stragglers:

```bash
bunx convex run migrations:runAll
```

### "Migration already running" error

Wait for the current run to complete, or cancel it:

```bash
bunx convex run --component migrations lib:cancel '{name: "migrations:migrateThreadsToProject"}'
```

---

## Phase 5: Remote Mode Changes

Phase 5 introduces CLI remote mode commands and new MCP tools. These are **backward compatible** and don't require database migrations.

### New Features

1. **CLI Remote Commands** (`btca remote ...`):
   - `btca remote link` - Authenticate with btca cloud via API key
   - `btca remote unlink` - Remove authentication
   - `btca remote status` - Show instance and project status
   - `btca remote wake` - Pre-warm the sandbox
   - `btca remote add <url>` - Add resource to remote config and sync
   - `btca remote sync` - Sync local config with cloud
   - `btca remote ask` - Ask questions via cloud
   - `btca remote grab <threadId>` - Output thread transcript
   - `btca remote init` - Initialize a remote config file

2. **New MCP Tools**:
   - `addResource` - Add a git resource via MCP
   - `sync` - Sync a local config with cloud

3. **CLI API Endpoints** (`/api/cli/...`):
   - `GET /api/cli/status` - Instance and project status
   - `POST /api/cli/wake` - Wake the sandbox
   - `GET /api/cli/threads` - List threads
   - `GET /api/cli/threads/:id` - Get thread with messages
   - `GET /api/cli/projects` - List projects
   - `GET /api/cli/questions` - List MCP questions

### Configuration Files

**Remote config** (`btca.remote.config.jsonc`):

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
			"searchPath": "apps/svelte.dev"
		}
	]
}
```

**Remote auth** (`~/.config/btca/remote-auth.json`):

```json
{
	"apiKey": "btca_xxxx...",
	"linkedAt": 1234567890
}
```

### Deployment Steps

1. **Deploy Schema/Code Changes**:

   ```bash
   # Deploy to Convex (includes new cli.ts actions)
   cd apps/web
   bunx convex deploy
   ```

2. **Deploy Web App**:

   ```bash
   # Build and deploy the web app (includes new API routes)
   bun run build
   # Deploy to your hosting provider
   ```

3. **Publish CLI**:
   ```bash
   # Build and publish the CLI with new remote commands
   cd apps/cli
   bun run build
   npm publish
   ```

### Testing

1. **Test CLI Remote Link**:

   ```bash
   # Create an API key in the web app at /app/settings/mcp
   btca remote link --key btca_your_key_here
   ```

2. **Test Remote Status**:

   ```bash
   btca remote status
   ```

3. **Test MCP addResource**:

   ```bash
   # Via MCP client or curl
   curl -X POST https://btca.dev/api/mcp \
     -H "Authorization: Bearer btca_your_key" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"addResource","arguments":{"url":"https://github.com/owner/repo","name":"repo","branch":"main"}}}'
   ```

4. **Test CLI API**:
   ```bash
   curl -X GET https://btca.dev/api/cli/status \
     -H "Authorization: Bearer btca_your_key"
   ```
