<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import {
		CreditCard,
		ExternalLink,
		HardDrive,
		Key,
		Loader2,
		Plus,
		Server,
		Trash2,
		User
	} from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '../../../convex/_generated/api';
	import { getAuthState, openUserProfile } from '$lib/stores/auth.svelte';
	import { getBillingStore } from '$lib/stores/billing.svelte';
	import { getShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { getThemeStore } from '$lib/stores/theme.svelte';
	import { BILLING_PLAN, SUPPORT_URL } from '$lib/billing/plans';
	import PricingPlans from '$lib/components/pricing/PricingPlans.svelte';
	import CopyButton from '$lib/CopyButton.svelte';
	import { getClerk } from '$lib/clerk';

	const auth = getAuthState();
	const client = useConvexClient();
	const billingStore = getBillingStore();
	const shikiStore = getShikiStore();
	const themeStore = getThemeStore();

	type TabId = 'account' | 'mcp' | 'usage' | 'billing';
	const tabs: { id: TabId; label: string; icon: typeof User }[] = [
		{ id: 'account', label: 'Account', icon: User },
		{ id: 'mcp', label: 'MCP Server', icon: Server },
		{ id: 'usage', label: 'Usage', icon: HardDrive },
		{ id: 'billing', label: 'Billing', icon: CreditCard }
	];

	const validTabs = new Set<TabId>(['account', 'mcp', 'usage', 'billing']);
	function isValidTab(tab: string | null): tab is TabId {
		return tab !== null && validTabs.has(tab as TabId);
	}

	// Initialize from URL or default to 'account'
	const initialTab = page.url.searchParams.get('tab');
	let activeTab = $state<TabId>(isValidTab(initialTab) ? initialTab : 'account');

	// Update URL when tab changes
	function setActiveTab(tab: TabId) {
		activeTab = tab;
		const url = new URL(page.url);
		url.searchParams.set('tab', tab);
		goto(url.toString(), { replaceState: true, keepFocus: true, noScroll: true });
	}

	const instanceId = $derived(auth.instanceId);

	// API Keys state (using Clerk)
	let clerkApiKeys = $state<
		Array<{
			id: string;
			name: string | null;
			createdAt: number;
		}>
	>([]);
	let isLoadingKeys = $state(true);

	// Query usage stats from our tracking table
	const usageQuery = $derived(
		instanceId ? useQuery(api.clerkApiKeysQueries.listUsageForUser, {}) : null
	);
	const usageByKeyId = $derived.by(() => {
		const map = new Map<string, { lastUsedAt?: number; usageCount: number }>();
		for (const usage of usageQuery?.data ?? []) {
			map.set(usage.clerkApiKeyId, {
				lastUsedAt: usage.lastUsedAt,
				usageCount: usage.usageCount
			});
		}
		return map;
	});

	let newKeyName = $state('');
	let newlyCreatedKey = $state<string | null>(null);
	let isCreating = $state(false);
	let showCreateModal = $state(false);
	let isRedirecting = $state(false);
	let errorMessage = $state<string | null>(null);

	// Load API keys from Clerk
	async function loadApiKeys() {
		const clerk = getClerk();
		if (!clerk) return;

		isLoadingKeys = true;
		try {
			const result = await clerk.apiKeys.getAll();
			clerkApiKeys = result.data.map((key) => ({
				id: key.id,
				name: key.name,
				createdAt: key.createdAt.getTime()
			}));
		} catch (error) {
			console.error('Failed to load API keys:', error);
		} finally {
			isLoadingKeys = false;
		}
	}

	// Load keys when auth is ready
	$effect(() => {
		if (auth.isSignedIn) {
			loadApiKeys();
		}
	});

	type McpTool = 'opencode' | 'claude-code';
	let selectedTool = $state<McpTool>('opencode');
	let modalSelectedTool = $state<McpTool>('opencode');

	const mcpUrl = $derived(
		page.url.hostname === 'localhost' ? `${page.url.origin}/api/mcp` : 'https://btca.dev/api/mcp'
	);

	const toolConfigs = $derived({
		opencode: {
			name: 'OpenCode',
			docsUrl: 'https://opencode.ai/docs/mcp-servers/#remote',
			filename: 'opencode.json',
			config: JSON.stringify(
				{
					$schema: 'https://opencode.ai/config.json',
					mcp: {
						'better-context': {
							type: 'remote',
							url: mcpUrl,
							enabled: true,
							headers: {
								Authorization: 'Bearer YOUR_API_KEY'
							}
						}
					}
				},
				null,
				2
			)
		},
		'claude-code': {
			name: 'Claude Code',
			docsUrl: 'https://code.claude.com/docs/en/mcp#option-1:-add-a-remote-http-server',
			filename: 'Terminal command',
			config: `claude mcp add --transport http better-context ${mcpUrl} \\
  --header "Authorization: Bearer YOUR_API_KEY"`
		}
	});

	const currentConfig = $derived(toolConfigs[selectedTool]);
	const shikiTheme = $derived(themeStore.theme === 'dark' ? 'dark-plus' : 'light-plus');

	// Config with actual API key for the modal
	const getConfigWithKey = (tool: McpTool, apiKey: string) => {
		if (tool === 'opencode') {
			return JSON.stringify(
				{
					$schema: 'https://opencode.ai/config.json',
					mcp: {
						'better-context': {
							type: 'remote',
							url: mcpUrl,
							enabled: true,
							headers: {
								Authorization: `Bearer ${apiKey}`
							}
						}
					}
				},
				null,
				2
			);
		} else {
			return `claude mcp add --transport http better-context ${mcpUrl} \\
  --header "Authorization: Bearer ${apiKey}"`;
		}
	};
	const modalConfig = $derived(
		newlyCreatedKey ? getConfigWithKey(modalSelectedTool, newlyCreatedKey) : ''
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

	const usage = $derived(billingStore.summary?.usage);
	const maxUsedPct = $derived(
		usage
			? Math.max(
					usage.tokensIn.usedPct ?? 0,
					usage.tokensOut.usedPct ?? 0,
					usage.sandboxHours.usedPct ?? 0
				)
			: 0
	);
	const remainingPct = $derived(100 - maxUsedPct);

	const formattedEndDate = $derived.by(() => {
		const end = billingStore.summary?.currentPeriodEnd;
		if (!end) return null;
		return new Date(end).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	});

	$effect(() => {
		if (!auth.isSignedIn && auth.isLoaded) {
			goto('/app');
		}
	});

	// Create a new API key via Clerk
	async function handleCreateKey() {
		const clerk = getClerk();
		if (!clerk || !newKeyName.trim()) return;

		isCreating = true;
		try {
			const result = await clerk.apiKeys.create({
				name: newKeyName.trim()
			});
			// IMPORTANT: result.secret is only available immediately after creation!
			newlyCreatedKey = result.secret ?? null;
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
		if (!clerk) return;
		if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return;

		try {
			await clerk.apiKeys.revoke({ apiKeyID: keyId });
			await loadApiKeys();
		} catch (error) {
			console.error('Failed to revoke API key:', error);
		}
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
		modalSelectedTool = 'opencode';
	}

	const formatPercent = (value: number | undefined) =>
		Number.isFinite(value) ? `${Math.round(value ?? 0)}%` : '0%';

	const tone = (pct?: number) => {
		if (pct == null) return 'hsl(var(--bc-accent))';
		if (pct <= 10) return 'hsl(var(--bc-error))';
		if (pct <= 25) return 'hsl(var(--bc-warning))';
		return 'hsl(var(--bc-accent))';
	};

	async function handleCheckout() {
		if (!auth.instanceId) return;
		errorMessage = null;
		isRedirecting = true;
		try {
			const result = await client.action(api.usage.createCheckoutSession, {
				instanceId: auth.instanceId,
				baseUrl: window.location.origin
			});
			window.location.href = result.url;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to start checkout';
		} finally {
			isRedirecting = false;
		}
	}

	async function handleManage() {
		if (!auth.instanceId) return;
		errorMessage = null;
		isRedirecting = true;
		try {
			const result = await client.action(api.usage.createBillingPortalSession, {
				instanceId: auth.instanceId,
				baseUrl: window.location.origin
			});
			window.location.href = result.url;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to open billing portal';
		} finally {
			isRedirecting = false;
		}
	}
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	<div class="mx-auto w-full max-w-5xl px-8 pt-8">
		<div class="mb-6 flex items-center justify-between">
			<div>
				<h1 class="text-2xl font-semibold">Settings</h1>
				<p class="bc-muted mt-1 text-sm">Manage your account and preferences.</p>
			</div>
		</div>

		<div class="mb-6 flex gap-1 border-b border-[hsl(var(--bc-border))]">
			{#each tabs as tab}
				<button
					type="button"
					class="flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors {activeTab ===
					tab.id
						? 'border-[hsl(var(--bc-accent))] text-[hsl(var(--bc-text))]'
						: 'border-transparent text-[hsl(var(--bc-muted))] hover:text-[hsl(var(--bc-text))]'}"
					onclick={() => setActiveTab(tab.id)}
				>
					<tab.icon size={16} />
					{tab.label}
				</button>
			{/each}
		</div>
	</div>

	<div class="flex-1 overflow-y-auto">
		<div class="mx-auto w-full max-w-5xl px-8 pb-8">
			{#if activeTab === 'account'}
				<div class="space-y-6">
					<div class="bc-card p-6">
						<div class="flex items-center gap-4">
							{#if auth.user?.imageUrl}
								<img
									src={auth.user.imageUrl}
									alt={auth.user.fullName ?? 'User'}
									class="h-16 w-16 rounded-full"
								/>
							{:else}
								<div class="bc-logoMark h-16 w-16">
									<User size={24} />
								</div>
							{/if}
							<div class="flex-1">
								<h2 class="text-lg font-semibold">{auth.user?.fullName ?? 'User'}</h2>
								<p class="bc-muted text-sm">
									{auth.user?.primaryEmailAddress?.emailAddress ?? ''}
								</p>
								{#if billingStore.isSubscribed}
									<span
										class="mt-2 inline-block rounded-full bg-[hsl(var(--bc-accent)/0.1)] px-2 py-0.5 text-xs font-medium text-[hsl(var(--bc-accent))]"
									>
										Pro Plan
									</span>
								{:else if billingStore.isOnFreePlan}
									<span
										class="mt-2 inline-block rounded-full bg-[hsl(var(--bc-muted)/0.2)] px-2 py-0.5 text-xs font-medium"
									>
										Free Plan
									</span>
								{/if}
							</div>
							<button type="button" class="bc-btn text-sm" onclick={() => openUserProfile()}>
								Edit Profile
							</button>
						</div>
					</div>

					{#if billingStore.isOnFreePlan}
						<div class="bc-card p-4">
							<div class="flex items-center justify-between">
								<div>
									<p class="font-medium">Free Plan</p>
									<p class="bc-muted mt-0.5 text-sm">
										{billingStore.freeMessagesRemaining} / {billingStore.freeMessagesTotal} free messages
										remaining
									</p>
								</div>
								<button
									onclick={() => setActiveTab('billing')}
									class="bc-btn bc-btn-primary text-sm">Upgrade to Pro</button
								>
							</div>
						</div>
					{:else if billingStore.isSubscribed && usage}
						<div class="bc-card p-4">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<HardDrive size={16} class="bc-muted" />
									<div>
										<p class="text-sm font-medium">Monthly Usage</p>
										<p class="bc-muted text-xs">{formatPercent(remainingPct)} remaining</p>
									</div>
								</div>
								<div class="h-2 w-32 overflow-hidden rounded-full bg-[hsl(var(--bc-muted)/0.2)]">
									<div
										class="h-full transition-all"
										style:width={`${maxUsedPct}%`}
										style:background-color={tone(remainingPct)}
									></div>
								</div>
							</div>
						</div>
					{/if}
				</div>
			{:else if activeTab === 'mcp'}
				<div class="space-y-6">
					{#if billingStore.isOnFreePlan}
						<div
							class="bc-card border-[hsl(var(--bc-warning)/0.5)] bg-[hsl(var(--bc-warning)/0.1)] p-4 text-sm"
						>
							<div class="flex items-center justify-between">
								<div>
									<p class="font-medium">Free Plan</p>
									<p class="bc-muted mt-0.5">
										{billingStore.freeMessagesRemaining} / {billingStore.freeMessagesTotal} free messages
										remaining
									</p>
								</div>
								{#if billingStore.freeMessagesRemaining === 0}
									<button
										onclick={() => setActiveTab('billing')}
										class="bc-btn bc-btn-primary text-xs">Upgrade to Pro</button
									>
								{:else}
									<button
										onclick={() => setActiveTab('billing')}
										class="bc-btn bc-btn-primary text-xs">Upgrade</button
									>
								{/if}
							</div>
						</div>
					{/if}

					<section class="space-y-4">
						<div class="flex items-center justify-between">
							<div>
								<h2 class="text-lg font-semibold">API Keys</h2>
								<p class="bc-muted text-sm">Manage your API keys for MCP access.</p>
							</div>
							<button
								type="button"
								class="bc-btn bc-btn-primary"
								onclick={() => (showCreateModal = true)}
							>
								<Plus size={16} />
								Create Key
							</button>
						</div>

						{#if isLoadingKeys}
							<div class="bc-card flex items-center justify-center p-8">
								<Loader2 size={24} class="animate-spin" />
							</div>
						{:else if clerkApiKeys.length === 0}
							<div class="bc-card p-6 text-center">
								<Key size={32} class="bc-muted mx-auto mb-3" />
								<p class="font-medium">No API keys yet</p>
								<p class="bc-muted mt-1 text-sm">Create one to connect your MCP clients.</p>
							</div>
						{:else}
							<div class="bc-card overflow-hidden">
								<table class="w-full text-sm">
									<thead class="border-b border-[hsl(var(--bc-border))]">
										<tr>
											<th class="bc-muted px-4 py-3 text-left text-xs font-medium uppercase"
												>Name</th
											>
											<th class="bc-muted px-4 py-3 text-left text-xs font-medium uppercase">ID</th>
											<th class="bc-muted px-4 py-3 text-left text-xs font-medium uppercase"
												>Created</th
											>
											<th class="bc-muted px-4 py-3 text-left text-xs font-medium uppercase"
												>Last Used</th
											>
											<th class="bc-muted px-4 py-3 text-left text-xs font-medium uppercase"
												>Usage</th
											>
											<th class="px-4 py-3"></th>
										</tr>
									</thead>
									<tbody class="divide-y divide-[hsl(var(--bc-border))]">
										{#each clerkApiKeys as key}
											{@const usage = usageByKeyId.get(key.id)}
											<tr>
												<td class="px-4 py-3 font-medium">{key.name ?? 'Unnamed key'}</td>
												<td class="px-4 py-3 font-mono text-xs">{key.id}</td>
												<td class="bc-muted px-4 py-3">{formatDate(key.createdAt)}</td>
												<td class="bc-muted px-4 py-3">
													{usage?.lastUsedAt ? formatDate(usage.lastUsedAt) : 'Never'}
												</td>
												<td class="bc-muted px-4 py-3">{usage?.usageCount ?? 0}</td>
												<td class="px-4 py-3 text-right">
													<button
														type="button"
														class="bc-muted hover:text-red-500"
														onclick={() => handleRevokeKey(key.id)}
														title="Revoke key"
													>
														<Trash2 size={16} />
													</button>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
							<p class="bc-muted mt-2 text-xs">
								The ID shown is for reference only — it's not your actual API key.
							</p>
						{/if}
					</section>

					<section class="space-y-4">
						<div>
							<h2 class="text-lg font-semibold">Setup Guide</h2>
							<p class="bc-muted text-sm">Configure your MCP client to use Better Context.</p>
						</div>

						<div class="space-y-6">
							<div class="bc-card p-5">
								<h3 class="mb-3 font-medium">1. Add to your MCP configuration</h3>

								<div class="mb-4 flex gap-1 rounded-lg bg-[hsl(var(--bc-bg-secondary))] p-1">
									{#each Object.entries(toolConfigs) as [key, tool]}
										<button
											type="button"
											class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors {selectedTool ===
											key
												? 'bg-[hsl(var(--bc-bg))] shadow-sm'
												: 'bc-muted hover:text-[hsl(var(--bc-text))]'}"
											onclick={() => (selectedTool = key as McpTool)}
										>
											{tool.name}
										</button>
									{/each}
								</div>

								<div class="mb-3 flex items-center justify-between">
									<p class="bc-muted text-sm">
										{#if selectedTool === 'claude-code'}
											Run this command in your terminal:
										{:else}
											Add this to <code class="rounded bg-[hsl(var(--bc-bg-secondary))] px-1"
												>{currentConfig.filename}</code
											>:
										{/if}
									</p>
									<a
										href={currentConfig.docsUrl}
										target="_blank"
										rel="noopener noreferrer"
										class="bc-muted flex items-center gap-1 text-xs hover:text-[hsl(var(--bc-text))]"
									>
										Docs
										<ExternalLink size={12} />
									</a>
								</div>
								<div class="bc-codeFrame">
									<div class="flex items-center justify-between gap-3 p-4">
										<div class="min-w-0 flex-1 overflow-x-auto">
											{#if shikiStore.highlighter}
												{@html shikiStore.highlighter.codeToHtml(currentConfig.config, {
													theme: shikiTheme,
													lang: selectedTool === 'claude-code' ? 'bash' : 'json',
													rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
												})}
											{:else}
												<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code
														>{currentConfig.config}</code
													></pre>
											{/if}
										</div>
										<CopyButton text={currentConfig.config} label="Copy configuration" />
									</div>
								</div>
								<p class="bc-muted mt-3 text-sm">
									Replace <code class="rounded bg-[hsl(var(--bc-bg-secondary))] px-1"
										>YOUR_API_KEY</code
									> with an API key from above.
								</p>
							</div>

							<div class="bc-card p-5">
								<h3 class="mb-3 font-medium">2. Add agent instructions (optional)</h3>
								<p class="bc-muted mb-3 text-sm">
									Add this to your <code class="rounded bg-[hsl(var(--bc-bg-secondary))] px-1"
										>AGENTS.md</code
									> or system prompt:
								</p>
								<div class="bc-codeFrame">
									<div class="flex items-center justify-between gap-3 p-4">
										<div class="min-w-0 flex-1 overflow-x-auto">
											<pre class="m-0 whitespace-pre-wrap text-sm leading-relaxed"><code
													>{agentInstructions}</code
												></pre>
										</div>
										<CopyButton text={agentInstructions} label="Copy agent instructions" />
									</div>
								</div>
							</div>
						</div>
					</section>
				</div>
			{:else if activeTab === 'usage'}
				<div class="space-y-6">
					{#if billingStore.isLoading}
						<div class="flex items-center justify-center py-12">
							<Loader2 size={28} class="animate-spin" />
						</div>
					{:else if !billingStore.isSubscribed}
						<div class="bc-card p-6">
							<p class="text-sm">
								No active subscription. <a href="/pricing" class="text-[hsl(var(--bc-accent))]"
									>Subscribe to view usage</a
								>.
							</p>
						</div>
					{:else}
						<div class="bc-card p-5">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<div class="bc-logoMark h-9 w-9">
										<HardDrive size={16} />
									</div>
									<div>
										<h2 class="text-sm font-semibold">Monthly Usage</h2>
										<p class="bc-muted text-xs">Usage across all resources</p>
									</div>
								</div>
								<span class="text-sm font-medium">
									{formatPercent(remainingPct)} remaining
								</span>
							</div>
							<div class="sandbox-progress-bar mt-4" style:width="100%">
								<div
									class="sandbox-progress-fill"
									style:width={`${maxUsedPct}%`}
									style:background-color={tone(remainingPct)}
								></div>
							</div>
						</div>

						{#if billingStore.isOverLimit}
							<div class="bc-card border-[hsl(var(--bc-error))] p-4 text-sm">
								You've hit your monthly usage limits. Contact
								<a
									href={SUPPORT_URL}
									target="_blank"
									rel="noreferrer"
									class="text-[hsl(var(--bc-accent))]">{SUPPORT_URL}</a
								> to raise them.
							</div>
						{/if}
					{/if}
				</div>
			{:else if activeTab === 'billing'}
				<div class="space-y-6">
					{#if billingStore.isLoading}
						<div class="flex items-center justify-center py-12">
							<Loader2 size={28} class="animate-spin" />
						</div>
					{:else if !billingStore.isSubscribed}
						<PricingPlans
							isSignedIn={auth.isSignedIn}
							isSubscribed={false}
							onCheckout={handleCheckout}
							{isRedirecting}
							{errorMessage}
						/>
					{:else}
						<div class="grid gap-4 md:grid-cols-2">
							<div class="bc-card p-5">
								<p class="bc-muted text-xs uppercase tracking-[0.2em]">Plan</p>
								<h2 class="mt-3 text-2xl font-semibold">{BILLING_PLAN.name}</h2>
								<p class="bc-muted text-sm">${BILLING_PLAN.priceUsd} per month</p>
								{#if billingStore.isCanceling && formattedEndDate}
									<p class="mt-3 text-xs text-amber-500">
										Cancels on {formattedEndDate}
									</p>
								{:else if formattedEndDate}
									<p class="bc-muted mt-3 text-xs">Renews on {formattedEndDate}</p>
								{/if}
							</div>

							<div class="bc-card p-5">
								<p class="bc-muted text-xs uppercase tracking-[0.2em]">Payment</p>
								{#if billingStore.summary?.paymentMethod?.card}
									<div class="mt-3 flex items-center justify-between">
										<div>
											<p class="text-sm font-medium">
												{billingStore.summary.paymentMethod.card.brand.toUpperCase()} ending in
												{billingStore.summary.paymentMethod.card.last4}
											</p>
											<p class="bc-muted text-xs">
												Expires {billingStore.summary.paymentMethod.card.exp_month}/
												{billingStore.summary.paymentMethod.card.exp_year}
											</p>
										</div>
										<CreditCard size={20} />
									</div>
								{:else}
									<p class="bc-muted mt-3 text-sm">No payment method on file yet.</p>
								{/if}
							</div>
						</div>

						<div class="bc-card p-5">
							<div class="flex items-center justify-between gap-4">
								<div>
									<h3 class="font-medium">Manage subscription</h3>
									<p class="bc-muted text-xs">Update payment method, cancel, or view invoices.</p>
								</div>
								<button
									type="button"
									class="bc-btn"
									onclick={handleManage}
									disabled={isRedirecting}
								>
									{#if isRedirecting}
										<Loader2 size={16} class="animate-spin" />
										Opening...
									{:else}
										Open portal
										<ExternalLink size={14} />
									{/if}
								</button>
							</div>
							{#if errorMessage}
								<p class="mt-3 text-xs text-red-500">{errorMessage}</p>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

{#if showCreateModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
		<div
			class="absolute inset-0"
			role="button"
			tabindex="-1"
			onclick={closeCreateModal}
			onkeydown={(e) => e.key === 'Escape' && closeCreateModal()}
		></div>
		<div class="bc-card relative z-10 w-full max-w-xl p-6">
			{#if newlyCreatedKey}
				<h3 class="text-lg font-semibold">API Key Created</h3>
				<p class="bc-muted mt-2 text-sm">
					Copy your configuration below. You won't be able to see this key again.
				</p>

				<div class="mt-4 flex gap-1 rounded-lg bg-[hsl(var(--bc-bg-secondary))] p-1">
					{#each Object.entries(toolConfigs) as [key, tool]}
						<button
							type="button"
							class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors {modalSelectedTool ===
							key
								? 'bg-[hsl(var(--bc-bg))] shadow-sm'
								: 'bc-muted hover:text-[hsl(var(--bc-text))]'}"
							onclick={() => (modalSelectedTool = key as McpTool)}
						>
							{tool.name}
						</button>
					{/each}
				</div>

				<div class="bc-codeFrame mt-4">
					<div class="flex items-start justify-between gap-3 p-4">
						<div class="min-w-0 flex-1 overflow-x-auto">
							{#if shikiStore.highlighter}
								{@html shikiStore.highlighter.codeToHtml(modalConfig, {
									theme: shikiTheme,
									lang: modalSelectedTool === 'claude-code' ? 'bash' : 'json',
									rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
								})}
							{:else}
								<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{modalConfig}</code
									></pre>
							{/if}
						</div>
						<CopyButton text={modalConfig} label="Copy configuration" />
					</div>
				</div>

				<p class="bc-muted mt-3 text-xs">
					{#if modalSelectedTool === 'claude-code'}
						Run this command in your terminal.
					{:else}
						Add this to <code class="rounded bg-[hsl(var(--bc-bg-secondary))] px-1"
							>{toolConfigs[modalSelectedTool].filename}</code
						>
					{/if}
				</p>

				<button type="button" class="bc-btn mt-4 w-full" onclick={closeCreateModal}>Done</button>
			{:else}
				<h3 class="text-lg font-semibold">Create API Key</h3>
				<p class="bc-muted mt-2 text-sm">
					Give your key a name to help you remember what it's used for.
				</p>
				<input
					type="text"
					bind:value={newKeyName}
					placeholder="e.g., OpenCode, Claude Desktop"
					class="bc-input mt-4 w-full"
					onkeydown={(e) => e.key === 'Enter' && handleCreateKey()}
				/>
				<div class="mt-4 flex gap-2">
					<button type="button" class="bc-btn flex-1" onclick={closeCreateModal}>Cancel</button>
					<button
						type="button"
						class="bc-btn bc-btn-primary flex-1"
						onclick={handleCreateKey}
						disabled={isCreating || !newKeyName.trim()}
					>
						{#if isCreating}
							<Loader2 size={16} class="animate-spin" />
							Creating...
						{:else}
							Create
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
