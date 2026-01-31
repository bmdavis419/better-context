<script lang="ts">
	import {
		AlertTriangle,
		CheckCircle2,
		ChevronDown,
		Clock,
		Database,
		Loader2,
		Play,
		RefreshCcw,
		Server,
		Square
	} from '@lucide/svelte';
	import { getInstanceStore } from '$lib/stores/instance.svelte';

	type InstanceAction = 'wake' | 'stop' | 'update' | 'reset';
	const instanceStore = getInstanceStore();
	let pendingAction = $state<InstanceAction | null>(null);
	let isExpanded = $state(false);

	const storageLimitBytes = 10 * 1024 * 1024 * 1024;
	const byteFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

	const stateMeta: Record<
		string,
		{
			label: string;
			description: string;
			tone: 'neutral' | 'success' | 'warning' | 'error';
			icon: typeof Loader2;
			spin?: boolean;
		}
	> = {
		unprovisioned: {
			label: 'Queued',
			description: 'Provisioning will start automatically.',
			tone: 'warning',
			icon: Server
		},
		provisioning: {
			label: 'Provisioning',
			description: 'Setting up your dedicated instance.',
			tone: 'warning',
			icon: Loader2,
			spin: true
		},
		stopped: {
			label: 'Stopped',
			description: 'Instance is idle and ready to wake.',
			tone: 'neutral',
			icon: Square
		},
		starting: {
			label: 'Starting',
			description: 'Booting the runtime.',
			tone: 'warning',
			icon: Loader2,
			spin: true
		},
		running: {
			label: 'Running',
			description: 'Instance is live and ready.',
			tone: 'success',
			icon: CheckCircle2
		},
		stopping: {
			label: 'Stopping',
			description: 'Shutting down to save resources.',
			tone: 'warning',
			icon: Loader2,
			spin: true
		},
		updating: {
			label: 'Updating',
			description: 'Installing the latest packages.',
			tone: 'warning',
			icon: RefreshCcw,
			spin: true
		},
		error: {
			label: 'Attention',
			description: 'Instance hit an error. Retry provisioning to recover.',
			tone: 'error',
			icon: AlertTriangle
		}
	};

	const stateInfo = $derived.by(() => {
		const state = instanceStore.state ?? 'unknown';
		return (
			stateMeta[state] ?? {
				label: 'Checking',
				description: 'Waiting for status data.',
				tone: 'neutral',
				icon: Loader2,
				spin: true
			}
		);
	});

	const StateIcon = $derived.by(() => stateInfo.icon);

	const stateBadgeClass = $derived.by(() => {
		switch (stateInfo.tone) {
			case 'success':
				return 'bc-badge bc-badge-success';
			case 'warning':
				return 'bc-badge bc-badge-warning';
			case 'error':
				return 'bc-badge bc-badge-error';
			default:
				return 'bc-badge';
		}
	});

	const isTransitioning = $derived.by(() =>
		['provisioning', 'starting', 'stopping', 'updating'].includes(instanceStore.state ?? '')
	);
	const hasInstance = $derived.by(() => Boolean(instanceStore.instance));
	const canWake = $derived.by(
		() => instanceStore.state === 'stopped' || instanceStore.state === 'error'
	);
	const canStop = $derived.by(() => instanceStore.state === 'running');
	const canUpdate = $derived.by(() => ['running', 'stopped'].includes(instanceStore.state ?? ''));
	const canReset = $derived.by(() => instanceStore.state === 'error');

	const storageUsed = $derived.by(() => instanceStore.storageUsedBytes ?? 0);
	const storagePercent = $derived.by(() => Math.min((storageUsed / storageLimitBytes) * 100, 100));

	const displayedResources = $derived.by(() => instanceStore.cachedResources.slice(0, 4));

	const updateSummary = $derived.by(() => {
		const parts: string[] = [];
		if (instanceStore.btcaUpdateAvailable) {
			parts.push(`btca: ${instanceStore.btcaVersion} → ${instanceStore.latestBtcaVersion}`);
		}
		if (instanceStore.opencodeUpdateAvailable) {
			parts.push(
				`opencode: ${instanceStore.opencodeVersion} → ${instanceStore.latestOpencodeVersion}`
			);
		}
		return parts.join(', ');
	});

	const errorText = $derived.by(
		() =>
			instanceStore.instance?.errorMessage ??
			instanceStore.error ??
			'Instance failed to start. Please retry.'
	);

	function formatBytes(bytes: number) {
		if (!bytes) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let value = bytes;
		let unitIndex = 0;
		while (value >= 1024 && unitIndex < units.length - 1) {
			value /= 1024;
			unitIndex += 1;
		}
		return `${byteFormatter.format(value)} ${units[unitIndex]}`;
	}

	function formatDateTime(timestamp?: number | null) {
		if (!timestamp) return 'Unknown';
		return new Date(timestamp).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatServerHost(url?: string | null) {
		if (!url) return null;
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	}

	async function runAction(action: InstanceAction) {
		if (pendingAction) return;
		pendingAction = action;
		try {
			if (action === 'wake') {
				await instanceStore.wake();
			} else if (action === 'stop') {
				await instanceStore.stop();
			} else if (action === 'reset') {
				await instanceStore.reset();
			} else {
				await instanceStore.update();
			}
		} finally {
			pendingAction = null;
		}
	}
</script>

<div class="relative" style="--delay: 40ms">
	<div class="bc-card bc-reveal relative overflow-hidden">
		<div
			class="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,116,51,0.16),transparent_60%)]"
		></div>
		<button
			type="button"
			class="relative z-10 flex w-full cursor-pointer items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-[hsl(var(--bc-surface-2)/0.5)]"
			onclick={() => (isExpanded = !isExpanded)}
		>
			<div class="flex items-center gap-3">
				<div class="bc-logoMark">
					<Server size={18} />
				</div>
				<div>
					<h2 class="text-lg font-semibold">Instance</h2>
					<p class="bc-muted text-xs">Your dedicated btca runtime</p>
				</div>
			</div>
			<div class="flex items-center gap-3">
				<div class="flex flex-wrap items-center gap-2">
					<span class={stateBadgeClass}>
						<StateIcon size={12} class={stateInfo.spin ? 'animate-spin' : ''} />
						{stateInfo.label}
					</span>
					{#if instanceStore.updateAvailable}
						<span class="bc-badge bc-badge-warning" title={updateSummary}>Update available</span>
					{/if}
				</div>
				<ChevronDown
					size={20}
					class="bc-muted shrink-0 transition-transform duration-200 {isExpanded
						? 'rotate-180'
						: ''}"
				/>
			</div>
		</button>
	</div>

	{#if isExpanded}
		<button
			type="button"
			class="fixed inset-0 z-40"
			onclick={() => (isExpanded = false)}
			aria-label="Close dropdown"
		></button>
		<div
			class="bc-card absolute left-0 right-0 top-full z-50 mt-1 flex max-h-[70vh] flex-col gap-6 overflow-y-auto p-6 shadow-xl"
		>
			{#if instanceStore.isLoading || instanceStore.isBootstrapping}
				<div class="flex items-center gap-2 text-sm">
					<Loader2 size={16} class="animate-spin" />
					{instanceStore.isBootstrapping
						? 'Setting up your instance...'
						: 'Loading instance data...'}
				</div>
			{:else if !hasInstance}
				<div class="bc-card bg-[hsl(var(--bc-surface-2))] p-4">
					<div class="flex items-start gap-3">
						<div class="bc-logoMark shrink-0">
							<Server size={16} />
						</div>
						<div class="min-w-0 flex-1">
							<h3 class="text-sm font-semibold">Instance not found</h3>
							<p class="bc-muted mt-1 text-xs">
								Your instance hasn't been set up yet. This usually happens automatically.
							</p>
							<button
								type="button"
								class="bc-btn mt-3 text-xs"
								onclick={() => instanceStore.ensureExists()}
							>
								<Loader2
									size={12}
									class={instanceStore.isBootstrapping ? 'animate-spin' : 'hidden'}
								/>
								Set up instance
							</button>
							{#if instanceStore.error}
								<p class="mt-2 text-xs text-red-500">{instanceStore.error}</p>
							{/if}
						</div>
					</div>
				</div>
			{:else}
				{#if instanceStore.state === 'error'}
					<div class="bc-card bg-[hsl(var(--bc-surface-2))] p-4">
						<div class="flex items-start gap-3">
							<div class="bc-logoMark shrink-0">
								<AlertTriangle size={16} />
							</div>
							<div class="min-w-0 flex-1">
								<h3 class="text-sm font-semibold">Instance needs attention</h3>
								<p class="mt-1 text-xs text-red-500">{errorText}</p>
								<button
									type="button"
									class="bc-btn mt-3 text-xs"
									onclick={() => runAction('reset')}
									disabled={!canReset || pendingAction !== null}
								>
									{#if pendingAction === 'reset'}
										<Loader2 size={12} class="animate-spin" />
										Retrying...
									{:else}
										<RefreshCcw size={12} />
										Retry provisioning
									{/if}
								</button>
							</div>
						</div>
					</div>
				{/if}
				<div class="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
					<div class="bc-card bg-[hsl(var(--bc-surface-2))] p-4">
						<div class="flex items-start justify-between gap-4">
							<div>
								<p class="bc-muted text-xs uppercase tracking-[0.2em]">Status</p>
								<h3 class="mt-2 text-lg font-semibold">{stateInfo.description}</h3>
								<p class="bc-muted mt-1 text-xs">State: {instanceStore.state}</p>
							</div>
							<div class="bc-logoMark">
								<StateIcon size={18} class={stateInfo.spin ? 'animate-spin' : ''} />
							</div>
						</div>
						<div class="mt-4 flex flex-wrap items-center gap-4 text-xs">
							<div class="flex items-center gap-2">
								<Clock size={14} />
								<span>
									Last active: {formatDateTime(instanceStore.instance?.lastActiveAt)}
								</span>
							</div>
							{#if formatServerHost(instanceStore.instance?.serverUrl)}
								<div class="flex items-center gap-2">
									<Server size={14} />
									<span>{formatServerHost(instanceStore.instance?.serverUrl)}</span>
								</div>
							{/if}
						</div>
					</div>

					<div class="bc-card bg-[hsl(var(--bc-surface-2))] p-4">
						<p class="bc-muted text-xs uppercase tracking-[0.2em]">Controls</p>
						<div class="mt-3 flex flex-col gap-2">
							<button
								type="button"
								class="bc-btn"
								onclick={() => runAction('wake')}
								disabled={!canWake || isTransitioning || pendingAction !== null}
							>
								{#if pendingAction === 'wake'}
									<Loader2 size={14} class="animate-spin" />
									Waking...
								{:else}
									<Play size={14} />
									Wake instance
								{/if}
							</button>
							<button
								type="button"
								class="bc-btn"
								onclick={() => runAction('stop')}
								disabled={!canStop || isTransitioning || pendingAction !== null}
							>
								{#if pendingAction === 'stop'}
									<Loader2 size={14} class="animate-spin" />
									Stopping...
								{:else}
									<Square size={14} />
									Stop instance
								{/if}
							</button>
							<button
								type="button"
								class="bc-btn"
								onclick={() => runAction('update')}
								disabled={!canUpdate || isTransitioning || pendingAction !== null}
							>
								{#if pendingAction === 'update'}
									<Loader2 size={14} class="animate-spin" />
									Updating...
								{:else}
									<RefreshCcw size={14} />
									Update packages
								{/if}
							</button>
						</div>
						{#if instanceStore.state !== 'error' && (instanceStore.error || instanceStore.instance?.errorMessage)}
							<div class="mt-3 flex items-start gap-2 text-xs text-red-500">
								<AlertTriangle size={14} />
								<span>{instanceStore.error ?? instanceStore.instance?.errorMessage}</span>
							</div>
						{/if}
					</div>
				</div>

				<div class="grid gap-4 md:grid-cols-2">
					<div class="bc-card bg-[hsl(var(--bc-surface-2))] p-4">
						<p class="bc-muted text-xs uppercase tracking-[0.2em]">Versions</p>
						<div class="mt-3 grid gap-2 text-sm">
							<div class="flex items-center justify-between gap-2">
								<span class="bc-muted">btca</span>
								<div class="flex items-center gap-2">
									<span>{instanceStore.btcaVersion ?? 'Unknown'}</span>
									{#if instanceStore.btcaUpdateAvailable}
										<span class="text-xs text-[hsl(var(--bc-warning))]">
											→ {instanceStore.latestBtcaVersion}
										</span>
									{/if}
								</div>
							</div>
							<div class="flex items-center justify-between gap-2">
								<span class="bc-muted">opencode</span>
								<div class="flex items-center gap-2">
									<span>{instanceStore.opencodeVersion ?? 'Unknown'}</span>
									{#if instanceStore.opencodeUpdateAvailable}
										<span class="text-xs text-[hsl(var(--bc-warning))]">
											→ {instanceStore.latestOpencodeVersion}
										</span>
									{/if}
								</div>
							</div>
						</div>
						<p class="bc-muted mt-2 text-xs">
							Last check: {formatDateTime(instanceStore.instance?.lastVersionCheck)}
						</p>
					</div>

					<div class="bc-card bg-[hsl(var(--bc-surface-2))] p-4">
						<p class="bc-muted text-xs uppercase tracking-[0.2em]">Storage</p>
						<div class="mt-3 flex items-center justify-between text-xs">
							<span class="bc-muted">Used</span>
							<span>
								{storageUsed
									? `${formatBytes(storageUsed)} of ${formatBytes(storageLimitBytes)}`
									: 'Usage pending'}
							</span>
						</div>
						<div
							class="mt-2 h-2 w-full border border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface))]"
						>
							<div
								class="h-full bg-[hsl(var(--bc-accent))]"
								style={`width: ${storagePercent}%`}
							></div>
						</div>
						<p class="bc-muted mt-2 text-xs">Storage updates after provisioning completes.</p>
					</div>
				</div>

				<div class="bc-card bg-[hsl(var(--bc-surface-2))] p-4">
					<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-2">
							<Database size={16} />
							<h3 class="text-sm font-semibold">Cached resources</h3>
						</div>
						<a href="/settings/resources" class="text-xs underline"> Manage </a>
					</div>
					{#if instanceStore.cachedResources.length === 0}
						<p class="bc-muted mt-3 text-sm">
							No cached resources yet. Mention a resource in chat to cache it.
						</p>
					{:else}
						<div class="mt-3 grid gap-2">
							{#each displayedResources as resource (resource._id)}
								<div
									class="flex flex-wrap items-center justify-between gap-3 border border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface))] px-3 py-2 text-xs"
								>
									<div class="flex flex-wrap items-center gap-2">
										<span class="bc-badge">@{resource.name}</span>
										<span class="bc-muted">{resource.branch}</span>
									</div>
									<span class="bc-muted">
										Last used: {formatDateTime(resource.lastUsedAt)}
									</span>
								</div>
							{/each}
							{#if instanceStore.cachedResources.length > displayedResources.length}
								<p class="bc-muted text-xs">
									+{instanceStore.cachedResources.length - displayedResources.length} more cached
								</p>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
