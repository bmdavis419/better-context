# Migration Plan: Per-User BTCA Instances + Convex-Centric Architecture

> **🤖 AGENT INSTRUCTIONS**
>
> This file is used by the autonomous migration agent (`deej.sh`). Each iteration:
>
> 1. Pick ONE unchecked task from the phases below
> 2. Implement it fully
> 3. Run `bun run check:chat-web` and `bun run format:chat-web`
> 4. Mark the task as done with `[x]`
> 5. Update `status.md` with notes
> 6. Exit to let the loop restart
>
> **Use btca liberally!** Available resources:
>
> - `btca ask -r convexDocs -q "..."` - Convex documentation
> - `btca ask -r convexJs -q "..."` - Convex JS SDK
> - `btca ask -r daytonaSdk -q "..."` - Daytona SDK
> - `btca ask -r clerk -q "..."` - Clerk auth
> - `btca ask -r svelte -q "..."` - Svelte docs
> - `btca ask -r svelteKit -q "..."` - SvelteKit docs
>
> **Quality checks:**
>
> - `bun run check:chat-web` - Type checking
> - `bun run format:chat-web` - Code formatting
> - Fix ALL errors before marking task complete

---

## Overview

This migration transforms the chat-web app from:

- **Current**: Per-thread sandboxes, business logic in SvelteKit API routes
- **Target**: Per-user BTCA instances, all business logic in Convex

### Key Benefits

- Users get their own persistent BTCA instance with cached resources
- Real-time UI updates for instance status (provisioning, running, stopped)
- Single source of truth in Convex
- Cleaner SvelteKit app (pure SPA, no API routes for business logic)
- Better UX with instance visibility and control

---

## Phase 1: Schema & Data Model Changes

### 1.1 Rename `users` table to `instances`

The current `users` table is really tracking sandbox/instance state. Rename and expand it:

```typescript
// convex/schema.ts
instances: defineTable({
  // Identity (from Clerk)
  clerkId: v.string(),

  // Daytona sandbox
  sandboxId: v.optional(v.string()),

  // Instance state (real-time updates to UI)
  state: v.union(
    v.literal('unprovisioned'),  // New user, no sandbox yet
    v.literal('provisioning'),   // Creating sandbox
    v.literal('stopped'),        // Sandbox exists but stopped
    v.literal('starting'),       // Waking up
    v.literal('running'),        // Active and ready
    v.literal('stopping'),       // Shutting down
    v.literal('updating'),       // Updating packages
    v.literal('error')           // Something went wrong
  ),
  serverUrl: v.optional(v.string()),
  errorMessage: v.optional(v.string()),

  // Version tracking
  btcaVersion: v.optional(v.string()),
  opencodeVersion: v.optional(v.string()),
  lastVersionCheck: v.optional(v.number()),
  updateAvailable: v.optional(v.boolean()),

  // Storage tracking
  storageUsedBytes: v.optional(v.number()),

  // Activity tracking (for billing)
  lastActiveAt: v.optional(v.number()),

  // Timestamps
  provisionedAt: v.optional(v.number()),
  createdAt: v.number()
})
  .index('by_clerk_id', ['clerkId'])
  .index('by_sandbox_id', ['sandboxId']),
```

### 1.2 Add `cachedResources` table

Track what's cached on each user's instance:

```typescript
cachedResources: defineTable({
  instanceId: v.id('instances'),
  name: v.string(),
  url: v.string(),
  branch: v.string(),
  sizeBytes: v.optional(v.number()),
  cachedAt: v.number(),
  lastUsedAt: v.number()
})
  .index('by_instance', ['instanceId']),
```

### 1.3 Update `threads` table

Remove `sandboxId` (now on instance), add `instanceId`:

```typescript
threads: defineTable({
  instanceId: v.id('instances'),  // Changed from userId
  title: v.optional(v.string()),
  createdAt: v.number(),
  lastActivityAt: v.number()
})
  .index('by_instance', ['instanceId']),
```

### 1.4 Keep existing tables

- `messages` - no changes needed
- `threadResources` - no changes needed
- `globalResources` - no changes needed
- `userResources` - rename to reference `instanceId`
- `apiKeys` - rename `userId` to `instanceId`

### Tasks

- [ ] Create new schema file with updated tables
- [ ] Write migration script to transform existing data
- [ ] Test migration on dev deployment

---

## Phase 2: Convex Functions - Instances

### 2.1 Instance Queries

```
convex/instances/queries.ts
```

- `get` - Get instance by ID
- `getByClerkId` - Get instance for current user
- `getStatus` - Get instance state, versions, cached resources

### 2.2 Instance Mutations

```
convex/instances/mutations.ts
```

- `create` - Create new instance record (called from Clerk webhook)
- `updateState` - Update instance state (internal)
- `setProvisioned` - Set sandboxId and versions after provisioning
- `setServerUrl` - Update server URL when started
- `setError` - Record error state
- `setVersions` - Update version info
- `touchActivity` - Update lastActiveAt for billing

### 2.3 Instance Actions

```
convex/instances/actions.ts
```

- `provision` - Create Daytona sandbox, install packages, stop
- `wake` - Start stopped sandbox, start btca server
- `stop` - Stop running sandbox
- `update` - Update btca/opencode packages
- `checkVersions` - Check npm registry for updates
- `destroy` - Delete sandbox entirely

### Tasks

- [ ] Create `convex/instances/` directory
- [ ] Implement queries.ts
- [ ] Implement mutations.ts
- [ ] Implement actions.ts (Daytona SDK integration)
- [ ] Add environment variables for Daytona API

---

## Phase 3: Convex HTTP Actions

### 3.1 Create HTTP Router

```
convex/http.ts
```

Routes:

- `POST /chat/stream` - Stream chat response (proxy to btca server)
- `POST /instance/wake` - Wake up stopped instance
- `POST /instance/stop` - Stop running instance
- `POST /instance/update` - Trigger package update
- `GET /instance/status` - Get current instance status
- `POST /webhooks/clerk` - Handle Clerk user.created webhook

### 3.2 Chat Streaming HTTP Action

The main streaming endpoint:

1. Verify auth (JWT from Clerk)
2. Ensure instance is running (wake if needed)
3. Save user message to DB
4. Proxy SSE stream from btca server
5. Save assistant message when complete
6. Track usage for billing

### 3.3 Clerk Webhook Handler

On `user.created`:

1. Create instance record with state='unprovisioned'
2. Schedule provisioning action
3. Instance state updates in real-time as provisioning progresses

### Tasks

- [ ] Create `convex/http.ts` with router
- [ ] Implement `/chat/stream` HTTP action
- [ ] Implement `/instance/*` HTTP actions
- [ ] Implement `/webhooks/clerk` HTTP action
- [ ] Configure CORS for client origin
- [ ] Add Clerk webhook secret to env vars

---

## Phase 4: Convex Scheduled Functions

### 4.1 Nightly Updates

```
convex/scheduled/updates.ts
```

- Run daily at 3am UTC
- Find all instances active in last 7 days
- For each: start, update packages, stop
- Update version info in DB

### 4.2 Version Check

```
convex/scheduled/versionCheck.ts
```

- Run every 6 hours
- Check npm registry for btca/opencode updates
- Update `updateAvailable` flag on instances

### Tasks

- [ ] Create `convex/scheduled/` directory
- [ ] Implement update cron job
- [ ] Implement version check cron job
- [ ] Configure cron schedules

---

## Phase 5: Migrate Existing Convex Functions

### 5.1 Update Thread Functions

- Change `userId` references to `instanceId`
- Remove `sandboxId` from threads
- Update `listWithSandbox` → remove (no longer needed)

### 5.2 Update Message Functions

- No schema changes needed
- Ensure mutations work with new flow

### 5.3 Update Resource Functions

- Change `userId` to `instanceId` in userResources

### 5.4 Remove/Update User Functions

- `getOrCreate` → becomes instance creation (via webhook)
- `updateSandboxActivity` → `instances.mutations.touchActivity`
- `setMcpSandboxId` → remove (single sandbox per user now)

### Tasks

- [ ] Update `convex/threads.ts`
- [ ] Update `convex/messages.ts`
- [ ] Update `convex/resources.ts`
- [ ] Refactor `convex/users.ts` → `convex/instances/`
- [ ] Update all API references

---

## Phase 6: Remove SvelteKit API Routes

### 6.1 Routes to Remove

```
src/routes/api/
├── mcp/+server.ts           → Move to Convex HTTP action
├── sessions/                → Remove (instance managed in Convex)
│   ├── +server.ts
│   ├── [sessionId]/
│   │   └── +server.ts
│   └── ...
└── threads/
    └── [threadId]/
        └── chat/+server.ts  → Move to Convex HTTP action
```

### 6.2 Server-Side Code to Remove

```
src/lib/server/
├── sandbox-service.ts       → Move to Convex actions
├── session-manager.ts       → Remove
├── usage.ts                 → Move to Convex
└── autumn.ts                → Keep (billing), but call from Convex
```

### Tasks

- [ ] Delete `src/routes/api/` directory
- [ ] Move sandbox logic to Convex actions
- [ ] Move usage tracking to Convex
- [ ] Update Autumn integration to work from Convex
- [ ] Remove unused server-side imports

---

## Phase 7: Update SvelteKit Client

### 7.1 New Stores

```
src/lib/stores/instance.svelte.ts
```

- Subscribe to instance query
- Expose instance state, versions, cached resources
- Methods to wake/stop/update instance

### 7.2 Update Auth Store

- Remove sandbox-related state
- Keep Clerk integration

### 7.3 Update Billing Store

- Call Convex for usage data
- Remove direct Autumn calls (Convex handles it)

### Tasks

- [ ] Create `instance.svelte.ts` store
- [ ] Update `auth.svelte.ts`
- [ ] Update `billing.svelte.ts`
- [ ] Remove unused stores

---

## Phase 8: New UI Components

### 8.1 Instance Dashboard Card

```
src/lib/components/InstanceCard.svelte
```

Shows:

- Instance state (running/stopped/etc)
- btca and opencode versions
- Update available indicator
- Cached resources list
- Storage usage bar
- Wake/Stop/Update buttons

### 8.2 Provisioning Modal

```
src/lib/components/ProvisioningModal.svelte
```

Full-screen overlay for first-time users:

- Progress steps (creating, installing, configuring)
- Animated progress bar
- Auto-dismisses when complete

### 8.3 Add Resource Quick Action

```
src/lib/components/AddResourceModal.svelte
```

- Text input for git URL
- Auto-detect repo name/branch
- Add to user's resources
- Shows on instance card

### Tasks

- [ ] Create `InstanceCard.svelte`
- [ ] Create `ProvisioningModal.svelte`
- [ ] Create `AddResourceModal.svelte`
- [ ] Update existing components to use new stores

---

## Phase 9: Update Pages

### 9.1 Home Page (`+page.svelte`)

- Show InstanceCard at top
- Show ProvisioningModal for new users
- Keep thread list below

### 9.2 Chat Page (`chat/[id]/+page.svelte`)

- Update to use HTTP Action for streaming
- Remove SvelteKit fetch calls
- Use instance store for status

### 9.3 Settings Pages

- Update to use instance store
- Add instance management section

### Tasks

- [ ] Update `src/routes/+page.svelte`
- [ ] Update `src/routes/chat/[id]/+page.svelte`
- [ ] Update settings pages
- [ ] Test all user flows

---

## Phase 10: Clerk Webhook Setup

### 10.1 Configure Clerk Dashboard

1. Go to Clerk Dashboard → Webhooks
2. Add endpoint: `https://<deployment>.convex.site/webhooks/clerk`
3. Select events: `user.created`
4. Copy signing secret

### 10.2 Add Environment Variables

```
CLERK_WEBHOOK_SECRET=whsec_...
```

### Tasks

- [ ] Configure Clerk webhook in dashboard
- [ ] Add webhook secret to Convex env vars
- [ ] Test webhook with new user signup
- [ ] Verify instance provisioning flow

---

## Phase 11: Testing & Migration

### 11.1 Data Migration

1. Export existing users/threads/messages
2. Transform to new schema
3. Create instance records for existing users
4. Import to new deployment

### 11.2 Testing Checklist

- [ ] New user signup → instance provisioned
- [ ] Instance wake/stop/update
- [ ] Chat streaming works
- [ ] Messages persist correctly
- [ ] Billing/usage tracking works
- [ ] Real-time UI updates
- [ ] Error handling (instance errors, stream errors)
- [ ] Multi-device sync

### 11.3 Rollout Plan

1. Deploy to staging
2. Test all flows
3. Migrate production data
4. Deploy to production
5. Monitor for issues

---

## Phase 12: Cleanup & Documentation

### 12.1 Remove Dead Code

- Old API routes
- Old server-side services
- Unused types/utilities

### 12.2 Update Documentation

- Update README.md
- Document new architecture
- Document Convex functions
- Update deployment guide

### Tasks

- [ ] Remove all dead code
- [ ] Update README.md
- [ ] Add architecture diagram
- [ ] Document environment variables

---

## File Structure (Final)

```
apps/chat-web/
├── src/
│   ├── convex/
│   │   ├── _generated/
│   │   ├── instances/
│   │   │   ├── queries.ts
│   │   │   ├── mutations.ts
│   │   │   └── actions.ts
│   │   ├── threads/
│   │   │   ├── queries.ts
│   │   │   └── mutations.ts
│   │   ├── messages/
│   │   │   ├── queries.ts
│   │   │   └── mutations.ts
│   │   ├── resources/
│   │   │   ├── queries.ts
│   │   │   └── mutations.ts
│   │   ├── scheduled/
│   │   │   ├── updates.ts
│   │   │   └── versionCheck.ts
│   │   ├── http.ts              # HTTP Actions router
│   │   ├── schema.ts
│   │   └── crons.ts             # Scheduled jobs
│   ├── lib/
│   │   ├── components/
│   │   │   ├── InstanceCard.svelte
│   │   │   ├── ProvisioningModal.svelte
│   │   │   ├── AddResourceModal.svelte
│   │   │   ├── ChatMessages.svelte
│   │   │   └── ...
│   │   ├── stores/
│   │   │   ├── instance.svelte.ts
│   │   │   ├── auth.svelte.ts
│   │   │   ├── billing.svelte.ts
│   │   │   └── theme.svelte.ts
│   │   ├── billing/
│   │   │   ├── plans.ts
│   │   │   └── types.ts
│   │   └── utils/
│   │       └── ...
│   └── routes/
│       ├── +layout.svelte
│       ├── +page.svelte          # Home with InstanceCard
│       ├── chat/
│       │   └── [id]/+page.svelte
│       ├── settings/
│       │   ├── billing/
│       │   ├── usage/
│       │   ├── resources/
│       │   └── api-keys/
│       └── pricing/
└── ...
```

---

## Environment Variables (Final)

```env
# Convex
PUBLIC_CONVEX_URL=https://...convex.cloud

# Clerk
PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_WEBHOOK_SECRET=whsec_...

# Daytona (in Convex dashboard)
DAYTONA_API_KEY=...
DAYTONA_API_URL=https://app.daytona.io/api

# OpenCode (in Convex dashboard)
OPENCODE_API_KEY=...

# Autumn/Billing (in Convex dashboard)
AUTUMN_SECRET_KEY=...

# CORS
CLIENT_ORIGIN=https://your-app.com
```

---

## Estimated Timeline

| Phase     | Description                | Effort       |
| --------- | -------------------------- | ------------ |
| 1         | Schema & Data Model        | 1 day        |
| 2         | Instance Functions         | 2 days       |
| 3         | HTTP Actions               | 2 days       |
| 4         | Scheduled Functions        | 0.5 day      |
| 5         | Migrate Existing Functions | 1 day        |
| 6         | Remove SvelteKit Routes    | 0.5 day      |
| 7         | Update Client Stores       | 1 day        |
| 8         | New UI Components          | 2 days       |
| 9         | Update Pages               | 1 day        |
| 10        | Clerk Webhook Setup        | 0.5 day      |
| 11        | Testing & Migration        | 2 days       |
| 12        | Cleanup & Docs             | 0.5 day      |
| **Total** |                            | **~14 days** |

---

## Risk Mitigation

### Risk: Daytona API changes

- **Mitigation**: Pin SDK version, test thoroughly

### Risk: Convex HTTP Action limits (20MB response)

- **Mitigation**: Stream responses, don't buffer entire response

### Risk: Data migration issues

- **Mitigation**: Test migration on staging first, keep backups

### Risk: Billing accuracy during transition

- **Mitigation**: Run parallel tracking, reconcile before cutover

---

## Success Criteria

- [ ] New users see provisioning flow on first login
- [ ] Users can see their instance status in real-time
- [ ] Chat streaming works through Convex HTTP Actions
- [ ] Instance wake/stop/update works from UI
- [ ] Cached resources persist across sessions
- [ ] Version updates can be triggered manually or automatically
- [ ] All existing functionality preserved
- [ ] No increase in error rates
- [ ] Billing accuracy maintained
