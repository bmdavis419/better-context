# MCP Server Implementation Plan

This document outlines the complete implementation plan for adding an MCP (Model Context Protocol) server to Better Context, hosted as a Convex HTTP action.

## Overview

The MCP server will provide two tools:
1. **`listResources`** - Lists all available documentation resources for the authenticated user
2. **`ask`** - Ask questions about specific resources (non-streaming)

Authentication uses API keys stored in Convex. The server is stateless (no SSE), making it compatible with Convex HTTP actions.

---

## Step 1: Schema & API Key Updates

### 1.1 Update Schema

**File:** `apps/web/src/convex/schema.ts`

Add `usageCount` to the `apiKeys` table:

```typescript
apiKeys: defineTable({
  instanceId: v.id('instances'),
  name: v.string(),
  keyHash: v.string(),
  keyPrefix: v.string(),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
  usageCount: v.optional(v.number())  // ADD THIS
})
  .index('by_instance', ['instanceId'])
  .index('by_key_hash', ['keyHash']),
```

### 1.2 Update API Key Mutations

**File:** `apps/web/src/convex/apiKeys.ts`

Modify `touchLastUsed` to also increment usage count:

```typescript
export const touchLastUsed = mutation({
  args: { keyId: v.id('apiKeys') },
  handler: async (ctx, args) => {
    const apiKey = await ctx.db.get(args.keyId);
    const instance = apiKey ? await ctx.db.get(apiKey.instanceId) : null;

    const currentCount = apiKey?.usageCount ?? 0;

    await ctx.db.patch(args.keyId, {
      lastUsedAt: Date.now(),
      usageCount: currentCount + 1
    });

    if (instance && apiKey) {
      await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
        distinctId: instance.clerkId,
        event: AnalyticsEvents.API_KEY_USED,
        properties: {
          instanceId: apiKey.instanceId,
          keyId: args.keyId,
          usageCount: currentCount + 1
        }
      });
    }
  }
});
```

Update `listByUser` to include usage count in the response:

```typescript
export const listByUser = query({
  args: { userId: v.id('instances') },
  handler: async (ctx, args) => {
    const keys = await ctx.db
      .query('apiKeys')
      .withIndex('by_instance', (q) => q.eq('instanceId', args.userId))
      .collect();

    return keys.map((k) => ({
      _id: k._id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      usageCount: k.usageCount ?? 0  // ADD THIS
    }));
  }
});
```

---

## Step 2: Install Dependencies

**File:** `apps/web/package.json`

Add the following dependencies:

```bash
cd apps/web
bun add tmcp @tmcp/transport-http @tmcp/adapter-zod
```

This will add:
- `tmcp` - Core MCP server library
- `@tmcp/transport-http` - HTTP transport for MCP
- `@tmcp/adapter-zod` - Zod schema adapter (already using zod in the project)

---

## Step 3: MCP Server Implementation

### 3.1 Create MCP Server Module

**File:** `apps/web/src/convex/mcp.ts` (NEW FILE)

```typescript
import { McpServer } from 'tmcp';
import { HttpTransport } from '@tmcp/transport-http';
import { ZodJsonSchemaAdapter } from '@tmcp/adapter-zod';
import { z } from 'zod';

import type { ActionCtx } from './_generated/server.js';
import type { Id } from './_generated/dataModel.js';
import { api } from './_generated/api.js';
import { instances } from './apiHelpers.js';

const instanceActions = instances.actions;
const instanceMutations = instances.mutations;
const instanceQueries = instances.queries;

export type McpContext = {
  ctx: ActionCtx;
  instanceId: Id<'instances'>;
  clerkId: string;
};

const createMcpServer = () => {
  const server = new McpServer(
    {
      name: 'better-context',
      version: '1.0.0',
      description: 'Better Context MCP Server - Documentation and codebase context'
    },
    {
      adapter: new ZodJsonSchemaAdapter(),
      capabilities: {
        tools: { listChanged: false }
      }
    }
  );

  server.tool(
    {
      name: 'listResources',
      description: 'List all available documentation resources. Call this first to see what resources you can query.'
    },
    async () => {
      const mcpCtx = server.ctx.custom as McpContext | undefined;
      if (!mcpCtx) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }],
          isError: true
        };
      }

      const resources = await mcpCtx.ctx.runQuery(api.resources.listAvailable, {
        instanceId: mcpCtx.instanceId
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(resources, null, 2) }]
      };
    }
  );

  server.tool(
    {
      name: 'ask',
      description:
        'Ask a question about specific documentation resources. You must call listResources first to get available resource names.',
      inputSchema: z.object({
        question: z.string().describe('The question to ask about the resources'),
        resources: z
          .array(z.string())
          .min(1)
          .describe('Array of resource names to query (from listResources). At least one required.')
      })
    },
    async ({ question, resources }) => {
      const mcpCtx = server.ctx.custom as McpContext | undefined;
      if (!mcpCtx) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Not authenticated' }) }],
          isError: true
        };
      }

      try {
        const result = await handleAskTool(mcpCtx, question, resources);
        return {
          content: [{ type: 'text', text: result }]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
          isError: true
        };
      }
    }
  );

  return server;
};

async function handleAskTool(
  mcpCtx: McpContext,
  question: string,
  resources: string[]
): Promise<string> {
  const { ctx, instanceId } = mcpCtx;

  // Validate resources exist for this user
  const availableResources = await ctx.runQuery(api.resources.listAvailable, { instanceId });
  const allResourceNames = [
    ...availableResources.global.map((r) => r.name),
    ...availableResources.custom.map((r) => r.name)
  ];

  const invalidResources = resources.filter((r) => !allResourceNames.includes(r));
  if (invalidResources.length > 0) {
    throw new Error(
      `Invalid resources: ${invalidResources.join(', ')}. Use listResources to see available resources.`
    );
  }

  // Check usage limits
  const usageCheck = await ctx.runAction(api.usage.ensureUsageAvailable, {
    instanceId,
    question,
    resources
  });

  if (!usageCheck?.ok) {
    const reason = (usageCheck as { reason?: string }).reason;
    if (reason === 'subscription_required') {
      throw new Error('Subscription required. Visit Better Context to subscribe.');
    }
    if (reason === 'free_limit_reached') {
      throw new Error('Free message limit reached. Upgrade to Pro to continue.');
    }
    throw new Error('Usage limits reached.');
  }

  // Get instance and ensure it's running
  const instance = await ctx.runQuery(instanceQueries.get, { instanceId });
  if (!instance) {
    throw new Error('Instance not found');
  }

  if (instance.state === 'error') {
    throw new Error('Instance is in an error state');
  }

  if (instance.state === 'provisioning' || instance.state === 'unprovisioned') {
    throw new Error('Instance is still provisioning');
  }

  // Wake instance if needed
  let serverUrl = instance.serverUrl;
  if (instance.state !== 'running' || !serverUrl) {
    if (!instance.sandboxId) {
      throw new Error('Instance does not have a sandbox');
    }
    const wakeResult = await ctx.runAction(instanceActions.wake, { instanceId });
    serverUrl = wakeResult.serverUrl;
    if (!serverUrl) {
      throw new Error('Failed to wake instance');
    }
  }

  // Make request to sandbox server (non-streaming)
  const response = await fetch(`${serverUrl}/question`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      resources,
      quiet: true
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Server error: ${response.status}`);
  }

  const result = await response.json();

  // Track usage
  const usageData = usageCheck as {
    inputTokens?: number;
    sandboxUsageHours?: number;
  };

  try {
    await ctx.runAction(api.usage.finalizeUsage, {
      instanceId,
      questionTokens: usageData.inputTokens ?? 0,
      outputChars: result.text?.length ?? 0,
      reasoningChars: 0,
      resources,
      sandboxUsageHours: usageData.sandboxUsageHours ?? 0
    });
  } catch (error) {
    console.error('Failed to track usage:', error);
  }

  // Touch instance activity
  await ctx.runMutation(instanceMutations.touchActivity, { instanceId });

  return result.text ?? JSON.stringify(result);
}

// Singleton instances
let mcpServer: ReturnType<typeof createMcpServer> | null = null;
let httpTransport: HttpTransport | null = null;

export const getMcpServer = () => {
  if (!mcpServer) {
    mcpServer = createMcpServer();
  }
  return mcpServer;
};

export const getMcpTransport = () => {
  if (!httpTransport) {
    httpTransport = new HttpTransport(getMcpServer(), { path: '/mcp' });
  }
  return httpTransport;
};
```

### 3.2 Note on Non-Streaming Endpoint

The `ask` tool uses `/question` (non-streaming) instead of `/question/stream`. Verify this endpoint exists on the sandbox server. If it doesn't exist, you may need to:

1. Add a `/question` POST endpoint to the sandbox server that returns `{ text: string }`, OR
2. Adapt the streaming endpoint to collect all chunks and return the final result

---

## Step 4: HTTP Routes

### 4.1 Update HTTP Router

**File:** `apps/web/src/convex/http.ts`

Add the following imports at the top:

```typescript
import { getMcpTransport, type McpContext } from './mcp.js';
```

Add the MCP handler and routes:

```typescript
// MCP Authentication Helper
async function validateMcpAuth(
  ctx: ActionCtx,
  request: Request
): Promise<{ valid: false; error: string } | { valid: true; context: McpContext }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or invalid Authorization header' };
  }

  const apiKey = authHeader.slice(7);
  if (!apiKey) {
    return { valid: false, error: 'Missing API key' };
  }

  const validation = await ctx.runQuery(api.apiKeys.validate, { apiKey });
  if (!validation.valid) {
    return { valid: false, error: validation.error };
  }

  // Touch last used (increment usage count)
  await ctx.runMutation(api.apiKeys.touchLastUsed, { keyId: validation.keyId });

  return {
    valid: true,
    context: {
      ctx,
      instanceId: validation.userId,
      clerkId: validation.clerkId
    }
  };
}

// MCP HTTP Action
const mcpHandler = httpAction(async (ctx, request) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('Origin');
    const headers = new Headers();
    const corsHeaders = getCorsHeaders(origin);
    for (const [key, value] of Object.entries(corsHeaders)) {
      headers.set(key, value);
    }
    return new Response(null, { status: 204, headers });
  }

  // Only allow POST for MCP messages
  if (request.method !== 'POST') {
    return corsTextResponse(request, 'Method not allowed', 405);
  }

  // Validate API key
  const auth = await validateMcpAuth(ctx, request);
  if (!auth.valid) {
    return corsTextResponse(request, auth.error, 401);
  }

  // Process MCP request
  const transport = getMcpTransport();
  const response = await transport.respond(request, auth.context);

  if (!response) {
    return corsTextResponse(request, 'Not found', 404);
  }

  return withCors(request, response);
});

// Add routes (add these near the other route definitions)
http.route({
  path: '/mcp',
  method: 'POST',
  handler: mcpHandler
});

http.route({
  path: '/mcp',
  method: 'OPTIONS',
  handler: mcpHandler
});
```

Also add the import for `api.apiKeys`:

```typescript
import { api, internal } from './_generated/api.js';
```

---

## Step 5: MCP Settings Page

### 5.1 Create MCP Settings Page

**File:** `apps/web/src/routes/app/settings/mcp/+page.svelte` (NEW FILE)

```svelte
<script lang="ts">
  import { useQuery, useMutation } from 'convex-svelte';
  import { api } from '$convex/_generated/api';
  import { authStore } from '$lib/stores/auth.svelte';
  import { env } from '$env/dynamic/public';

  const instanceId = $derived(authStore.instanceId);

  const apiKeysQuery = $derived(
    instanceId ? useQuery(api.apiKeys.listByUser, { userId: instanceId }) : null
  );
  const apiKeys = $derived(apiKeysQuery?.data ?? []);

  const createKeyMutation = useMutation(api.apiKeys.create);
  const revokeKeyMutation = useMutation(api.apiKeys.revoke);

  let newKeyName = $state('');
  let newlyCreatedKey = $state<string | null>(null);
  let isCreating = $state(false);
  let showCreateModal = $state(false);

  const convexUrl = env.PUBLIC_CONVEX_URL?.replace('.cloud', '.site') ?? 'https://your-app.convex.site';

  const mcpConfig = $derived(
    JSON.stringify(
      {
        mcpServers: {
          'better-context': {
            type: 'http',
            url: `${convexUrl}/mcp`,
            headers: {
              Authorization: 'Bearer YOUR_API_KEY'
            }
          }
        }
      },
      null,
      2
    )
  );

  const agentInstructions = `## Better Context MCP

Use the Better Context MCP for documentation questions.

**Required workflow:**
1. Call \`listResources\` first to see available resources
2. Call \`ask\` with your question and resource names from step 1

**Rules:**
- Always call \`listResources\` before \`ask\`
- Use exact \`name\` values from \`listResources\` in the \`resources\` array
- Include at least one resource in every \`ask\` call
- Only include resources relevant to your question`;

  async function handleCreateKey() {
    if (!instanceId || !newKeyName.trim()) return;

    isCreating = true;
    try {
      const result = await createKeyMutation.mutate({
        userId: instanceId,
        name: newKeyName.trim()
      });
      newlyCreatedKey = result.key;
      newKeyName = '';
    } finally {
      isCreating = false;
    }
  }

  async function handleRevokeKey(keyId: string) {
    if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return;
    await revokeKeyMutation.mutate({ keyId });
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  function formatDate(timestamp: number) {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function closeCreateModal() {
    showCreateModal = false;
    newlyCreatedKey = null;
    newKeyName = '';
  }
</script>

<div class="space-y-8 p-6">
  <div>
    <h1 class="text-2xl font-bold text-white">MCP Server</h1>
    <p class="mt-1 text-sm text-zinc-400">
      Connect Better Context to your AI tools via the Model Context Protocol.
    </p>
  </div>

  <!-- API Keys Section -->
  <section class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-white">API Keys</h2>
      <button
        onclick={() => (showCreateModal = true)}
        class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        Create Key
      </button>
    </div>

    {#if apiKeys.length === 0}
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center">
        <p class="text-zinc-400">No API keys yet. Create one to get started.</p>
      </div>
    {:else}
      <div class="overflow-hidden rounded-lg border border-zinc-800">
        <table class="w-full">
          <thead class="bg-zinc-900">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Name</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Key</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Created</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Last Used</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Usage</th>
              <th class="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-400">Status</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-800 bg-zinc-950">
            {#each apiKeys as key}
              <tr>
                <td class="px-4 py-3 text-sm text-white">{key.name}</td>
                <td class="px-4 py-3 font-mono text-sm text-zinc-400">{key.keyPrefix}...</td>
                <td class="px-4 py-3 text-sm text-zinc-400">{formatDate(key.createdAt)}</td>
                <td class="px-4 py-3 text-sm text-zinc-400">
                  {key.lastUsedAt ? formatDate(key.lastUsedAt) : 'Never'}
                </td>
                <td class="px-4 py-3 text-sm text-zinc-400">{key.usageCount ?? 0}</td>
                <td class="px-4 py-3">
                  {#if key.revokedAt}
                    <span class="rounded-full bg-red-900/50 px-2 py-0.5 text-xs text-red-400">
                      Revoked
                    </span>
                  {:else}
                    <span class="rounded-full bg-green-900/50 px-2 py-0.5 text-xs text-green-400">
                      Active
                    </span>
                  {/if}
                </td>
                <td class="px-4 py-3 text-right">
                  {#if !key.revokedAt}
                    <button
                      onclick={() => handleRevokeKey(key._id)}
                      class="text-sm text-red-400 hover:text-red-300"
                    >
                      Revoke
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- MCP Setup Section -->
  <section class="space-y-4">
    <h2 class="text-lg font-semibold text-white">Setup Guide</h2>

    <div class="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div>
        <h3 class="mb-2 text-sm font-medium text-white">1. Add to your MCP configuration</h3>
        <p class="mb-2 text-sm text-zinc-400">
          Add this to your MCP servers config (e.g., in opencode, Cursor, or Claude Desktop):
        </p>
        <div class="relative">
          <pre class="overflow-x-auto rounded-md bg-zinc-950 p-3 text-sm text-zinc-300">{mcpConfig}</pre>
          <button
            onclick={() => copyToClipboard(mcpConfig)}
            class="absolute right-2 top-2 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700"
          >
            Copy
          </button>
        </div>
        <p class="mt-2 text-sm text-zinc-500">
          Replace <code class="text-zinc-400">YOUR_API_KEY</code> with an API key from above.
        </p>
      </div>

      <div>
        <h3 class="mb-2 text-sm font-medium text-white">2. Add agent instructions (optional)</h3>
        <p class="mb-2 text-sm text-zinc-400">
          Add this to your <code class="text-zinc-400">AGENTS.md</code> or system prompt:
        </p>
        <div class="relative">
          <pre class="overflow-x-auto rounded-md bg-zinc-950 p-3 text-sm text-zinc-300 whitespace-pre-wrap">{agentInstructions}</pre>
          <button
            onclick={() => copyToClipboard(agentInstructions)}
            class="absolute right-2 top-2 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-700"
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  </section>
</div>

<!-- Create Key Modal -->
{#if showCreateModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div class="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      {#if newlyCreatedKey}
        <h3 class="text-lg font-semibold text-white">API Key Created</h3>
        <p class="mt-2 text-sm text-zinc-400">
          Copy your API key now. You won't be able to see it again.
        </p>
        <div class="mt-4 flex items-center gap-2">
          <code class="flex-1 rounded bg-zinc-950 p-2 text-sm text-green-400 break-all">
            {newlyCreatedKey}
          </code>
          <button
            onclick={() => copyToClipboard(newlyCreatedKey!)}
            class="rounded bg-zinc-800 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-700"
          >
            Copy
          </button>
        </div>
        <button
          onclick={closeCreateModal}
          class="mt-4 w-full rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Done
        </button>
      {:else}
        <h3 class="text-lg font-semibold text-white">Create API Key</h3>
        <p class="mt-2 text-sm text-zinc-400">
          Give your key a name to help you remember what it's used for.
        </p>
        <input
          type="text"
          bind:value={newKeyName}
          placeholder="e.g., Cursor, opencode, Claude Desktop"
          class="mt-4 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:outline-none"
        />
        <div class="mt-4 flex gap-2">
          <button
            onclick={closeCreateModal}
            class="flex-1 rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            onclick={handleCreateKey}
            disabled={isCreating || !newKeyName.trim()}
            class="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isCreating ? 'Creating...' : 'Create'}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
```

### 5.2 Add Navigation Link

**File:** `apps/web/src/lib/components/Sidebar.svelte`

Add a link to the MCP settings page in the settings navigation:

```svelte
<a href="/app/settings/mcp" class="...">MCP Server</a>
```

---

## Step 6: Analytics Events (Optional)

### 6.1 Add MCP-specific Analytics Events

**File:** `apps/web/src/convex/analyticsEvents.ts`

Add new events for MCP usage tracking:

```typescript
export const AnalyticsEvents = {
  // ... existing events ...
  MCP_LIST_RESOURCES: 'mcp_list_resources',
  MCP_ASK: 'mcp_ask',
  MCP_ASK_FAILED: 'mcp_ask_failed',
} as const;
```

---

## Testing Guide

### Prerequisites

1. Complete all implementation steps above
2. Deploy to Convex: `cd apps/web && bunx convex deploy`
3. Have the sandbox server running with a `/question` endpoint

### Test 1: Create an API Key

1. Navigate to `/app/settings/mcp` in the web app
2. Click "Create Key"
3. Enter a name (e.g., "Test Key")
4. Copy the generated key (starts with `btca_`)

### Test 2: Test listResources via curl

```bash
curl -X POST https://your-app.convex.site/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer btca_YOUR_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

Expected response: List of available tools including `listResources` and `ask`.

### Test 3: Call listResources

```bash
curl -X POST https://your-app.convex.site/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer btca_YOUR_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "listResources",
      "arguments": {}
    }
  }'
```

Expected response: JSON with `global` and `custom` resource arrays.

### Test 4: Call ask

```bash
curl -X POST https://your-app.convex.site/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer btca_YOUR_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "ask",
      "arguments": {
        "question": "How do I create a reactive variable in Svelte 5?",
        "resources": ["svelte"]
      }
    }
  }'
```

Expected response: Answer text from the sandbox server.

### Test 5: Test with opencode

1. Add to your opencode MCP config:

```json
{
  "mcpServers": {
    "better-context": {
      "type": "http",
      "url": "https://your-app.convex.site/mcp",
      "headers": {
        "Authorization": "Bearer btca_YOUR_API_KEY"
      }
    }
  }
}
```

2. Start opencode and verify the MCP server connects
3. Ask a question that should trigger the Better Context tools

### Test 6: Verify Usage Tracking

1. After making several API calls, check the MCP settings page
2. Verify the "Usage" count has incremented
3. Verify "Last Used" timestamp has updated

### Test 7: Test Invalid API Key

```bash
curl -X POST https://your-app.convex.site/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid_key" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

Expected response: 401 Unauthorized

### Test 8: Test Invalid Resource

```bash
curl -X POST https://your-app.convex.site/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer btca_YOUR_API_KEY" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "ask",
      "arguments": {
        "question": "Test question",
        "resources": ["nonexistent-resource"]
      }
    }
  }'
```

Expected response: Error indicating invalid resource name.

---

## Troubleshooting

### "Module not found" errors after adding dependencies

Run `bunx convex deploy` again to ensure dependencies are bundled.

### CORS errors in browser

The MCP endpoint includes CORS headers. If testing from a browser, ensure the origin is in the allowed list.

### "Instance is still provisioning"

The user's sandbox needs to be provisioned first. They should use the web app at least once to trigger provisioning.

### API key validation fails

- Check the key starts with `btca_`
- Ensure the key hasn't been revoked
- Verify the key was created for the correct user

### Sandbox server returns 404 for /question

The non-streaming `/question` endpoint may need to be added to the sandbox server. Check the btca server implementation.

---

## Future Enhancements

1. **Streaming support** - If Convex adds streaming HTTP response support
2. **Rate limiting per key** - Add request rate limits independent of usage
3. **Key scopes** - Add read-only vs read-write scopes
4. **Detailed usage logs** - Track individual requests with timestamps and resources used
5. **Key expiration** - Add optional expiration dates for API keys
