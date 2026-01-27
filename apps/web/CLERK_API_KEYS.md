# Clerk API Keys Migration Plan

This document outlines the migration from custom API key management to Clerk's API keys feature.

## Overview

**Current state:** Custom `apiKeys` table in Convex with SHA-256 hashing, custom UI for management
**Target state:** Clerk manages API key lifecycle, we track usage in a lightweight table

## Prerequisites

1. Enable API keys in Clerk Dashboard:
   - Navigate to https://dashboard.clerk.com/~/platform/api-keys
   - Select "Enable API keys"
   - Enable "User API keys" (not organization keys)

2. Add `@clerk/backend` dependency:
   ```bash
   cd apps/web && bun add @clerk/backend
   ```

---

## Phase 1: Add New Schema and Verification Helper

### 1.1 Update Schema

**File:** `src/convex/schema.ts`

Add new `apiKeyUsage` table for tracking usage (the old `apiKeys` table will be removed in Phase 4):

```typescript
apiKeyUsage: defineTable({
	clerkApiKeyId: v.string(), // "ak_xxx" from Clerk
	clerkUserId: v.string(), // "user_xxx" - the subject from Clerk
	instanceId: v.id('instances'),
	name: v.optional(v.string()), // Cached name for display
	lastUsedAt: v.optional(v.number()),
	usageCount: v.number(),
	createdAt: v.number()
})
	.index('by_clerk_api_key_id', ['clerkApiKeyId'])
	.index('by_instance', ['instanceId']);
```

### 1.2 Create Clerk Verification Helper

**File:** `src/convex/clerkApiKeys.ts` (new file)

```typescript
'use node';

import { createClerkClient } from '@clerk/backend';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery } from './_generated/server';
import { AnalyticsEvents } from './analyticsEvents';

const getClerkClient = () => {
	const secretKey = process.env.CLERK_SECRET_KEY;
	if (!secretKey) {
		throw new Error('CLERK_SECRET_KEY environment variable is not set');
	}
	return createClerkClient({ secretKey });
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ApiKeyValidationResult =
	| {
			valid: true;
			clerkApiKeyId: string;
			clerkUserId: string;
			instanceId: Id<'instances'>;
	  }
	| {
			valid: false;
			error: string;
	  };

// ─────────────────────────────────────────────────────────────────────────────
// Actions (public API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate an API key using Clerk and return the associated instance.
 * This is the main entry point for API key validation.
 */
export const validate = action({
	args: { apiKey: v.string() },
	handler: async (ctx, args): Promise<ApiKeyValidationResult> => {
		const { apiKey } = args;

		// Verify with Clerk
		let clerkResult: { id: string; subject: string; name: string | null };
		try {
			const clerkClient = getClerkClient();
			clerkResult = await clerkClient.apiKeys.verify(apiKey);
		} catch (error) {
			// Clerk throws on invalid/revoked/expired keys
			const message = error instanceof Error ? error.message : 'Invalid API key';
			return { valid: false, error: message };
		}

		const clerkApiKeyId = clerkResult.id;
		const clerkUserId = clerkResult.subject;

		// Get instance by Clerk user ID (using internal query since we don't have auth context)
		const instance = await ctx.runQuery(internal['instances/queries'].getByClerkIdInternal, {
			clerkId: clerkUserId
		});

		if (!instance) {
			return { valid: false, error: 'No instance found for this user' };
		}

		// Track usage
		await ctx.runMutation(internal.clerkApiKeys.touchUsage, {
			clerkApiKeyId,
			clerkUserId,
			instanceId: instance._id,
			name: clerkResult.name ?? undefined
		});

		// Track analytics asynchronously
		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: clerkUserId,
			event: AnalyticsEvents.API_KEY_USED,
			properties: {
				instanceId: instance._id,
				apiKeyId: clerkApiKeyId
			}
		});

		return {
			valid: true,
			clerkApiKeyId,
			clerkUserId,
			instanceId: instance._id
		};
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal Mutations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update usage tracking for an API key.
 * Creates a new record if this is the first use.
 */
export const touchUsage = internalMutation({
	args: {
		clerkApiKeyId: v.string(),
		clerkUserId: v.string(),
		instanceId: v.id('instances'),
		name: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { clerkApiKeyId, clerkUserId, instanceId, name } = args;

		const existing = await ctx.db
			.query('apiKeyUsage')
			.withIndex('by_clerk_api_key_id', (q) => q.eq('clerkApiKeyId', clerkApiKeyId))
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, {
				lastUsedAt: Date.now(),
				usageCount: existing.usageCount + 1,
				...(name && { name })
			});
		} else {
			await ctx.db.insert('apiKeyUsage', {
				clerkApiKeyId,
				clerkUserId,
				instanceId,
				name,
				lastUsedAt: Date.now(),
				usageCount: 1,
				createdAt: Date.now()
			});
		}
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List usage stats for an instance's API keys.
 * Used by the UI to show usage information alongside Clerk's key list.
 */
export const listUsageByInstance = internalQuery({
	args: { instanceId: v.id('instances') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('apiKeyUsage')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();
	}
});
```

### 1.3 Add Internal Query for Instance Lookup

**File:** `src/convex/instances/queries.ts`

Add a new internal query to look up instances by Clerk ID (needed because the existing `getByClerkId` requires auth context, but we're validating via API key):

```typescript
/**
 * Internal query to get instance by Clerk ID
 * Used by API key validation when we have the Clerk user ID but no auth context
 */
export const getByClerkIdInternal = internalQuery({
	args: { clerkId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('instances')
			.withIndex('by_clerk_id', (q) => q.eq('clerkId', args.clerkId))
			.first();
	}
});
```

This will be accessible via `instances.internalQueries.getByClerkIdInternal` through the `apiHelpers.ts` re-exports.

---

## Phase 2: Update CLI and MCP Actions

### 2.1 Update CLI Actions

**File:** `src/convex/cli.ts`

Replace all `api.apiKeys.validate` calls with `api.clerkApiKeys.validate`:

**Before:**

```typescript
// Validate API key
const validation = await ctx.runQuery(api.apiKeys.validate, { apiKey });
if (!validation.valid) {
	return { ok: false, error: validation.error };
}
const instanceId = validation.userId;
```

**After:**

```typescript
// Validate API key with Clerk
const validation = await ctx.runAction(api.clerkApiKeys.validate, { apiKey });
if (!validation.valid) {
	return { ok: false, error: validation.error };
}
const instanceId = validation.instanceId;
```

Functions to update in `cli.ts`:

- `getInstanceStatus` (line ~49)
- `wakeInstance` (line ~106)
- `listProjects` (line ~164)
- `listThreads` (line ~202)
- `getThread` (line ~251)
- `listQuestions` (line ~298)

### 2.2 Update MCP Actions

**File:** `src/convex/mcp.ts`

Same pattern as CLI - replace all `api.apiKeys.validate` calls:

Functions to update in `mcp.ts`:

- `ask` (line ~68)
- `listResources` (line ~199)
- `addResource` (line ~256)
- `sync` (line ~331)

Also remove the `api.apiKeys.touchLastUsed` calls since usage is now tracked in the validation action:

**Remove these lines:**

```typescript
// Remove - no longer needed
await ctx.runMutation(api.apiKeys.touchLastUsed, { keyId: validation.keyId });
```

---

## Phase 3: Update UI to Use Clerk's API

The app uses `@clerk/clerk-js` directly. We'll update the existing UI to use Clerk's Frontend API for API key management instead of Convex mutations.

### 3.1 Update Settings Page

**File:** `src/routes/app/settings/+page.svelte`

**Changes to make:**

1. **Remove Convex API key imports and queries:**

```typescript
// REMOVE these:
const apiKeysQuery = $derived(instanceId ? useQuery(api.apiKeys.list, {}) : null);
const apiKeys = $derived(apiKeysQuery?.data ?? []);
```

2. **Add Clerk API key state and functions:**

```svelte
<script lang="ts">
	import { getClerk } from '$lib/clerk';

	// API Keys state (using Clerk)
	let clerkApiKeys = $state<
		Array<{
			id: string;
			name: string | null;
			createdAt: number;
		}>
	>([]);
	let isLoadingKeys = $state(true);
	let newKeyName = $state('');
	let newlyCreatedKey = $state<string | null>(null);
	let isCreating = $state(false);
	let showCreateModal = $state(false);

	// Load API keys from Clerk
	async function loadApiKeys() {
		const clerk = getClerk();
		if (!clerk?.user) return;

		isLoadingKeys = true;
		try {
			const result = await clerk.user.apiKeys.getAll();
			clerkApiKeys = result.data.map((key) => ({
				id: key.id,
				name: key.name,
				createdAt: key.createdAt
			}));
		} catch (error) {
			console.error('Failed to load API keys:', error);
		} finally {
			isLoadingKeys = false;
		}
	}

	// Create a new API key via Clerk
	async function handleCreateKey() {
		const clerk = getClerk();
		if (!clerk?.user || !newKeyName.trim()) return;

		isCreating = true;
		try {
			const result = await clerk.user.apiKeys.create({
				name: newKeyName.trim()
			});
			// IMPORTANT: result.secret is only available immediately after creation!
			newlyCreatedKey = result.secret;
			newKeyName = '';
			await loadApiKeys();
		} catch (error) {
			console.error('Failed to create API key:', error);
		} finally {
			isCreating = false;
		}
	}

	// Revoke an API key via Clerk
	async function handleRevokeKey(keyId: string) {
		const clerk = getClerk();
		if (!clerk?.user) return;
		if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return;

		try {
			await clerk.user.apiKeys.revoke({ apiKeyId: keyId });
			await loadApiKeys();
		} catch (error) {
			console.error('Failed to revoke API key:', error);
		}
	}

	// Load keys when auth is ready
	$effect(() => {
		if (auth.isSignedIn) {
			loadApiKeys();
		}
	});
</script>
```

3. **Update the template to use `clerkApiKeys` instead of `apiKeys`:**

Replace references to `apiKeys` with `clerkApiKeys` and `apiKeysQuery?.isLoading` with `isLoadingKeys`.

The existing HTML structure can remain largely the same - just update the data source:

```svelte
<!-- Change this: -->
{#each apiKeys as key}

<!-- To this: -->
{#each clerkApiKeys as key}
```

```svelte
<!-- Change this: -->
{#if apiKeysQuery?.isLoading}

<!-- To this: -->
{#if isLoadingKeys}
```

4. **Update key display (Clerk doesn't store keyPrefix):**

Since Clerk doesn't expose a key prefix, update the display:

```svelte
<!-- Change from showing keyPrefix: -->
<code class="bc-muted">{key.keyPrefix}...</code>

<!-- To showing key ID: -->
<code class="bc-muted">{key.id}</code>
```

### 3.2 Update Questions Settings Page

**File:** `src/routes/app/settings/questions/+page.svelte`

Apply the same changes as the main settings page:

- Remove Convex `apiKeysQuery` and related state
- Add Clerk API key loading/create/revoke functions
- Update template to use `clerkApiKeys`

### 3.3 Type Definitions

Clerk's `APIKeyResource` type (from `@clerk/types`) has these relevant fields:

- `id: string` - The API key ID (e.g., "ak_xxx")
- `name: string | null` - User-provided name
- `subject: string` - The user/org ID this key belongs to
- `createdAt: number` - Creation timestamp
- `secret: string` - **Only available on create response!**

You may want to add a type for the UI:

```typescript
interface ClerkApiKey {
	id: string;
	name: string | null;
	createdAt: number;
}
```

### 3.4 Display Usage Stats (Optional Enhancement)

To show usage stats (last used, usage count) alongside Clerk's API keys, query the `apiKeyUsage` table:

```svelte
<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api';

	// Query usage stats from our tracking table
	const usageQuery = $derived(
		instanceId ? useQuery(api.clerkApiKeys.listUsageByInstance, { instanceId }) : null
	);
	const usageByKeyId = $derived(() => {
		const map = new Map<string, { lastUsedAt?: number; usageCount: number }>();
		for (const usage of usageQuery?.data ?? []) {
			map.set(usage.clerkApiKeyId, {
				lastUsedAt: usage.lastUsedAt,
				usageCount: usage.usageCount
			});
		}
		return map;
	});
</script>

<!-- In the key list: -->
{#each clerkApiKeys as key}
	{@const usage = usageByKeyId().get(key.id)}
	<div class="flex items-center justify-between">
		<div>
			<p class="font-medium">{key.name ?? 'Unnamed key'}</p>
			<p class="text-sm text-muted">
				Created {formatDate(key.createdAt)}
				{#if usage?.lastUsedAt}
					| Last used {formatDate(usage.lastUsedAt)}
					| {usage.usageCount} uses
				{:else}
					| Never used
				{/if}
			</p>
		</div>
		<!-- ... revoke button -->
	</div>
{/each}
```

**Note:** This requires adding a public query to `clerkApiKeys.ts`:

```typescript
/**
 * List usage stats for the authenticated user's API keys.
 * Public query - requires auth.
 */
export const listUsageForUser = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];

		const instance = await ctx.db
			.query('instances')
			.withIndex('by_clerk_id', (q) => q.eq('clerkId', identity.subject))
			.first();

		if (!instance) return [];

		return await ctx.db
			.query('apiKeyUsage')
			.withIndex('by_instance', (q) => q.eq('instanceId', instance._id))
			.collect();
	}
});
```

---

## Phase 4: Cleanup

### 4.1 Remove Old API Keys File

**Delete:** `src/convex/apiKeys.ts`

### 4.2 Update Schema

**File:** `src/convex/schema.ts`

Remove the old `apiKeys` table definition (lines 98-109):

```typescript
// DELETE THIS:
apiKeys: defineTable({
  instanceId: v.id('instances'),
  name: v.string(),
  keyHash: v.string(),
  keyPrefix: v.string(),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  usageCount: v.optional(v.number())
})
  .index('by_instance', ['instanceId'])
  .index('by_key_hash', ['keyHash']),
```

### 4.3 Remove Auth Helper

**File:** `src/convex/authHelpers.ts`

Remove `requireApiKeyOwnership` function (lines 120-147) as it's no longer needed.

### 4.4 Clean Up Imports

Search for and remove any imports of the old `apiKeys` module:

```typescript
// Remove these imports wherever they appear:
import { api } from './_generated/api';
// Specifically: api.apiKeys.*
```

### 4.5 Data Migration

Create a migration to clean up old API key data:

**File:** `src/convex/migrations.ts` (add to existing or create)

```typescript
import { internalMutation } from './_generated/server';

/**
 * Migration: Remove old apiKeys data after Clerk migration.
 * Run this after confirming the new system works.
 */
export const cleanupOldApiKeys = internalMutation({
	handler: async (ctx) => {
		const oldKeys = await ctx.db.query('apiKeys').collect();
		let deleted = 0;
		for (const key of oldKeys) {
			await ctx.db.delete(key._id);
			deleted++;
		}
		return { deleted };
	}
});
```

---

## Environment Variables

Ensure these are set in your Convex environment:

```bash
# Already should exist
CLERK_SECRET_KEY=sk_live_xxx  # or sk_test_xxx for development

# Verify in Convex dashboard under Settings > Environment Variables
```

---

## Testing Checklist

1. **Create API key in Clerk UI**
   - Go to settings page
   - Create a new API key
   - Copy the secret (only shown once!)

2. **Test CLI authentication**

   ```bash
   btca remote link --key <new-clerk-api-key>
   btca remote status
   ```

3. **Test MCP authentication**
   - Configure MCP client with new API key
   - Call `listResources` tool
   - Call `ask` tool

4. **Verify usage tracking**
   - Check Convex dashboard for `apiKeyUsage` table entries
   - Verify `usageCount` increments on each use

5. **Test key revocation**
   - Revoke key in Clerk UI
   - Verify CLI/MCP calls fail with "Invalid API key"

---

## Rollback Plan

If issues arise:

1. Keep the old `apiKeys.ts` file until migration is confirmed working
2. The old table can remain in schema during transition
3. To rollback: revert imports in `cli.ts` and `mcp.ts` to use `api.apiKeys.validate`

---

## File Change Summary

| File                                             | Action                                                |
| ------------------------------------------------ | ----------------------------------------------------- |
| `src/convex/schema.ts`                           | Add `apiKeyUsage` table, later remove `apiKeys` table |
| `src/convex/clerkApiKeys.ts`                     | **CREATE** - New Clerk verification helper            |
| `src/convex/instances/queries.ts`                | Add `getByClerkIdInternal` query                      |
| `src/convex/cli.ts`                              | Update validation calls                               |
| `src/convex/mcp.ts`                              | Update validation calls, remove `touchLastUsed` calls |
| `src/convex/apiKeys.ts`                          | **DELETE** after migration                            |
| `src/convex/authHelpers.ts`                      | Remove `requireApiKeyOwnership`                       |
| `src/routes/app/settings/+page.svelte`           | Replace custom UI with Clerk API calls                |
| `src/routes/app/settings/questions/+page.svelte` | Replace custom UI with Clerk API calls                |
| `package.json`                                   | Add `@clerk/backend` dependency                       |
