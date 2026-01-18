<script lang="ts">
	import { Loader2, Plus, Key, Copy, Trash2, Check, Plug, BookOpen, Wrench } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api';
	import { getAuthState } from '$lib/stores/auth.svelte';
	import { getBillingStore } from '$lib/stores/billing.svelte';
	import { SUPPORT_URL } from '$lib/billing/plans';
	import InstanceCard from '$lib/components/InstanceCard.svelte';

	const MCP_URL = 'https://chat.bettercontext.ai/api/convex/mcp';

	let instructionsCopied = $state(false);

	const auth = getAuthState();
	const billingStore = getBillingStore();
	const client = useConvexClient();

	const keysQuery = $derived(
		auth.instanceId && billingStore.isSubscribed
			? useQuery(api.apiKeys.listByUser, { userId: auth.instanceId })
			: null
	);

	let showCreate = $state(false);
	let newKeyName = $state('');
	let isCreating = $state(false);
	let createdKey = $state<string | null>(null);
	let copied = $state(false);
	let configCopied = $state(false);
	let errorMessage = $state<string | null>(null);

	const keys = $derived(keysQuery?.data ?? []);

	const mcpConfig = $derived(
		JSON.stringify(
			{
				mcpServers: {
					btca: {
						type: 'http',
						url: MCP_URL,
						headers: {
							Authorization: `Bearer ${createdKey ?? 'YOUR_API_KEY'}`
						}
					}
				}
			},
			null,
			2
		)
	);

	$effect(() => {
		if (!auth.isSignedIn && auth.isLoaded) {
			goto('/');
		}
	});

	async function createKey() {
		if (!auth.instanceId || !billingStore.isSubscribed) return;
		if (!newKeyName.trim()) {
			errorMessage = 'Name is required';
			return;
		}
		isCreating = true;
		errorMessage = null;
		try {
			const result = await client.mutation(api.apiKeys.create, {
				userId: auth.instanceId,
				name: newKeyName.trim()
			});
			createdKey = result.key;
			newKeyName = '';
			showCreate = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to create key';
		} finally {
			isCreating = false;
		}
	}

	async function revokeKey(keyId: string) {
		if (!auth.instanceId) return;
		if (!confirm('Revoke this API key?')) return;
		try {
			await client.mutation(api.apiKeys.revoke, {
				keyId: keyId as any
			});
		} catch (err) {
			console.error('Failed to revoke key', err);
		}
	}

	async function copyKey() {
		if (!createdKey) return;
		try {
			await navigator.clipboard.writeText(createdKey);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch (err) {
			console.error('Failed to copy key', err);
		}
	}

	async function copyConfig() {
		try {
			await navigator.clipboard.writeText(mcpConfig);
			configCopied = true;
			setTimeout(() => (configCopied = false), 1500);
		} catch (err) {
			console.error('Failed to copy config', err);
		}
	}

	function dismissKey() {
		createdKey = null;
		copied = false;
		configCopied = false;
	}

	const agentInstructions = `When the user asks about documentation, libraries, or frameworks, use the btca MCP server to get accurate answers.

Tool: question
- question (required): The question to ask
- resources (optional): Array of resource names to search, e.g. ["svelte", "tailwind"]

Example usage:
- "How do I set up routing in SvelteKit?" → question({ question: "How do I set up routing in SvelteKit?", resources: ["svelteKit"] })
- "What's the Tailwind config for dark mode?" → question({ question: "What's the Tailwind config for dark mode?", resources: ["tailwind"] })

If resources is omitted, all available resources will be searched.`;

	async function copyInstructions() {
		try {
			await navigator.clipboard.writeText(agentInstructions);
			instructionsCopied = true;
			setTimeout(() => (instructionsCopied = false), 1500);
		} catch (err) {
			console.error('Failed to copy instructions', err);
		}
	}

	function formatDate(timestamp?: number) {
		if (!timestamp) return 'N/A';
		return new Date(timestamp).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<div class="flex flex-1 overflow-y-auto">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8 pb-16">
		<InstanceCard />
		<div>
			<h1 class="text-2xl font-semibold">MCP Server</h1>
			<p class="bc-muted mt-1 text-sm">
				Connect btca to your favorite AI tools via the Model Context Protocol.
			</p>
		</div>

		{#if !billingStore.isSubscribed}
			<div class="bc-card p-6 text-sm">
				<p>
					MCP access requires an active subscription. <a href="/pricing">Subscribe to enable</a>.
				</p>
			</div>
		{:else}
			<div class="bc-card p-5">
				<div class="flex items-start gap-4">
					<div class="bc-logoMark shrink-0">
						<Plug size={18} />
					</div>
					<div class="min-w-0 flex-1">
						<h2 class="font-semibold">Quick Setup</h2>
						<p class="bc-muted mt-1 text-sm">
							Add the following configuration to your MCP client (Cursor, Claude Desktop, etc.):
						</p>
						<div class="mt-4">
							<div class="code-block-wrapper">
								<div class="code-block-header">
									<span class="code-lang">JSON</span>
									<button type="button" class="copy-btn" onclick={copyConfig}>
										{#if configCopied}
											<Check size={12} /> Copied
										{:else}
											<Copy size={12} /> Copy
										{/if}
									</button>
								</div>
								<div class="code-content">
									<pre class="text-sm"><code>{mcpConfig}</code></pre>
								</div>
							</div>
						</div>
						<p class="bc-muted mt-3 text-xs">
							Replace <code class="bc-card px-1.5 py-0.5 text-xs">YOUR_API_KEY</code> with a key generated
							below.
						</p>
					</div>
				</div>
			</div>

			<div class="bc-card p-5">
				<div class="flex items-start gap-4">
					<div class="bc-logoMark shrink-0">
						<Wrench size={18} />
					</div>
					<div class="min-w-0 flex-1">
						<h2 class="font-semibold">Available Tools</h2>
						<p class="bc-muted mt-1 text-sm">
							The btca MCP server exposes these tools for AI agents:
						</p>
						<div class="mt-4">
							<div class="bc-card bg-[hsl(var(--bc-surface-2))] p-4">
								<div class="flex items-center gap-2">
									<code class="text-sm font-semibold">question</code>
								</div>
								<p class="bc-muted mt-1 text-xs">
									Ask btca a question about your configured documentation resources. Streams the
									full answer as text.
								</p>
								<div class="mt-3">
									<div class="text-xs font-medium">Parameters:</div>
									<ul class="bc-muted mt-1 list-inside list-disc text-xs">
										<li>
											<code class="text-[11px]">question</code>
											<span class="bc-muted">(required)</span> — The question to ask
										</li>
										<li>
											<code class="text-[11px]">resources</code>
											<span class="bc-muted">(optional)</span> — Array of resource names to search
											(e.g.
											<code class="text-[11px]">["svelte", "tailwind"]</code>). If omitted, searches
											all available resources.
										</li>
									</ul>
								</div>
							</div>
						</div>
						<p class="bc-muted mt-3 text-xs">
							Manage your available resources in <a href="/settings/resources"
								>Settings → Resources</a
							>.
						</p>
					</div>
				</div>
			</div>

			<div class="bc-card p-5">
				<div class="flex items-start gap-4">
					<div class="bc-logoMark shrink-0">
						<BookOpen size={18} />
					</div>
					<div class="min-w-0 flex-1">
						<h2 class="font-semibold">Agent Instructions</h2>
						<p class="bc-muted mt-1 text-sm">
							Add these instructions to your AI agent's system prompt or rules file:
						</p>
						<div class="mt-4">
							<div class="code-block-wrapper">
								<div class="code-block-header">
									<span class="code-lang">Instructions</span>
									<button type="button" class="copy-btn" onclick={copyInstructions}>
										{#if instructionsCopied}
											<Check size={12} /> Copied
										{:else}
											<Copy size={12} /> Copy
										{/if}
									</button>
								</div>
								<div class="code-content">
									<pre class="whitespace-pre-wrap text-sm">{agentInstructions}</pre>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			{#if createdKey}
				<div class="bc-card border-[hsl(var(--bc-warning))] p-4 text-sm">
					<div class="flex items-center justify-between gap-4">
						<div class="flex items-center gap-2">
							<Key size={16} />
							<span class="font-medium">New key created (shown once)</span>
						</div>
						<button type="button" class="bc-chip p-2" onclick={dismissKey}>Dismiss</button>
					</div>
					<div class="mt-3 flex flex-col gap-2">
						<code class="bc-card break-all p-3 text-xs">{createdKey}</code>
						<div class="flex gap-2">
							<button type="button" class="bc-btn text-xs" onclick={copyKey}>
								{#if copied}
									<Check size={14} /> Copied
								{:else}
									<Copy size={14} /> Copy Key
								{/if}
							</button>
							<button type="button" class="bc-btn bc-btn-primary text-xs" onclick={copyConfig}>
								{#if configCopied}
									<Check size={14} /> Copied
								{:else}
									<Copy size={14} /> Copy Full Config
								{/if}
							</button>
						</div>
					</div>
				</div>
			{/if}

			<div class="flex items-center justify-between">
				<h2 class="text-lg font-medium">API Keys</h2>
				<button
					type="button"
					class="bc-btn bc-btn-primary text-sm"
					onclick={() => (showCreate = !showCreate)}
				>
					<Plus size={16} />
					New Key
				</button>
			</div>

			{#if showCreate}
				<div class="bc-card p-4">
					<label for="new-key-name" class="text-xs font-medium">Key name</label>
					<input
						id="new-key-name"
						type="text"
						class="bc-input mt-2"
						placeholder="e.g. Cursor, Claude Desktop"
						bind:value={newKeyName}
					/>
					{#if errorMessage}
						<p class="mt-2 text-xs text-red-500">{errorMessage}</p>
					{/if}
					<div class="mt-3 flex gap-2">
						<button type="button" class="bc-btn text-xs" onclick={() => (showCreate = false)}>
							Cancel
						</button>
						<button
							type="button"
							class="bc-btn bc-btn-primary text-xs"
							onclick={createKey}
							disabled={isCreating}
						>
							{#if isCreating}
								<Loader2 size={14} class="animate-spin" />
								Creating...
							{:else}
								Create Key
							{/if}
						</button>
					</div>
				</div>
			{/if}

			{#if keysQuery?.isLoading}
				<div class="flex items-center justify-center py-8">
					<Loader2 size={24} class="animate-spin" />
				</div>
			{:else if keys.length === 0}
				<div class="bc-card p-6 text-sm">
					<p class="bc-muted">No API keys yet. Create one to connect your MCP client.</p>
				</div>
			{:else}
				<div class="grid gap-3">
					{#each keys as key (key._id)}
						<div class="bc-card flex items-center justify-between gap-4 p-4">
							<div>
								<div class="flex items-center gap-2">
									<span class="font-medium">{key.name}</span>
									{#if key.revokedAt}
										<span class="bc-badge bc-badge-error">Revoked</span>
									{/if}
								</div>
								<div class="bc-muted mt-1 text-xs">{key.keyPrefix}</div>
								<div class="bc-muted mt-1 text-xs">
									Created {formatDate(key.createdAt)} | Last used {formatDate(key.lastUsedAt)}
								</div>
							</div>
							{#if !key.revokedAt}
								<button
									type="button"
									class="bc-chip p-2 text-red-500"
									onclick={() => revokeKey(key._id)}
								>
									<Trash2 size={14} />
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<div
				class="bc-card mt-4 border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface-2))] p-4 text-xs"
			>
				<p class="bc-muted">
					API keys authenticate MCP requests. If you need higher rate limits, contact
					<a href={SUPPORT_URL} target="_blank" rel="noreferrer">support</a>.
				</p>
			</div>
		{/if}
	</div>
</div>
