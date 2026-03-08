<script lang="ts">
	import {
		AlertTriangle,
		CheckCircle2,
		Loader2,
		Play,
		RefreshCcw,
		RotateCcw,
		Server,
		Square
	} from '@lucide/svelte';
	import { getInstanceStore } from '$lib/stores/instance.svelte';
	import { INSTANCE_DISK_FULL_MESSAGE } from '$lib/instanceErrors';

	type InstanceAction = 'wake' | 'stop' | 'update' | 'reset';

	const instanceStore = getInstanceStore();
	let pendingAction = $state<InstanceAction | null>(null);
	let isExpanded = $state(false);

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
			description: 'Instance hit an error. Try waking again.',
			tone: 'error',
			icon: AlertTriangle
		}
	};

	const stateInfo = $derived.by(() => {
		const state = instanceStore.state ?? 'unknown';
		if (state === 'error' && instanceStore.errorKind === 'disk_full') {
			return {
				label: 'Cache full',
				description: 'Your instance cache is full. Reset it to continue.',
				tone: 'error' as const,
				icon: AlertTriangle
			};
		}
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
	const isErrorState = $derived.by(() => instanceStore.state === 'error');
	const canWake = $derived.by(
		() => instanceStore.state === 'stopped' || instanceStore.state === 'error'
	);
	const canStop = $derived.by(() => instanceStore.state === 'running');
	const canUpdate = $derived.by(() => ['running', 'stopped'].includes(instanceStore.state ?? ''));
	const canReset = $derived.by(() => instanceStore.state === 'error');
	const isDiskFullError = $derived.by(() => instanceStore.errorKind === 'disk_full');

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

	function formatDateTime(timestamp?: number | null) {
		if (!timestamp) return 'Unknown';
		return new Date(timestamp).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function handleClickOutside(event: MouseEvent) {
		if (!isExpanded) return;
		const target = event.target as HTMLElement;
		if (!target.closest('.instance-status')) {
			isExpanded = false;
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

<svelte:window onclick={handleClickOutside} />

<div class="instance-status relative">
	<button
		type="button"
		class="bc-card flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
		onclick={() => (isExpanded = !isExpanded)}
	>
		<div class="flex min-w-0 items-center gap-2">
			<div class="bc-logoMark h-6 w-6 shrink-0">
				<Server size={12} />
			</div>
			<div class="min-w-0">
				<div class="text-xs font-semibold">Instance</div>
				<div class="bc-muted text-[9px]">Dedicated runtime</div>
			</div>
		</div>
		<div class="flex shrink-0 items-center gap-1.5">
			<span class="{stateBadgeClass} text-[10px] px-1.5 py-0.5">
				<StateIcon size={10} class={stateInfo.spin ? 'animate-spin' : ''} />
				{stateInfo.label}
			</span>
			{#if instanceStore.updateAvailable}
				<span class="bc-badge bc-badge-warning text-[10px] px-1.5 py-0.5" title={updateSummary}
					>Update</span
				>
			{/if}
		</div>
	</button>

	{#if isExpanded}
		<div class="bc-card bc-sidebar-dropdown mt-2 flex flex-col gap-4 p-4">
			{#if instanceStore.isLoading || instanceStore.isBootstrapping}
				<div class="flex items-center gap-2 text-xs">
					<Loader2 size={14} class="animate-spin" />
					{instanceStore.isBootstrapping
						? 'Setting up your instance...'
						: 'Loading instance data...'}
				</div>
			{:else if !hasInstance}
				<div class="text-xs">
					<div class="font-semibold">Instance not found</div>
					<p class="bc-muted mt-1">
						Your instance hasn't been set up yet. This usually happens automatically.
					</p>
					<button
						type="button"
						class="bc-btn mt-3 text-xs"
						onclick={() => instanceStore.ensureExists()}
					>
						<Loader2 size={12} class={instanceStore.isBootstrapping ? 'animate-spin' : 'hidden'} />
						Set up instance
					</button>
					{#if instanceStore.error}
						<p class="mt-2 text-xs text-red-500">{instanceStore.error}</p>
					{/if}
				</div>
			{:else}
				<div class="text-xs">
					<div class="flex items-start justify-between gap-3">
						<div>
							<div class="text-sm font-semibold">{stateInfo.description}</div>
							<div class="bc-muted mt-1">State: {instanceStore.state}</div>
							<div class="bc-muted mt-1">
								Last active: {formatDateTime(instanceStore.instance?.lastActiveAt)}
							</div>
						</div>
						<StateIcon size={16} class={stateInfo.spin ? 'animate-spin' : ''} />
					</div>
				</div>
				{#if isErrorState}
					<div class="flex flex-col gap-2 rounded border border-red-500/30 bg-red-500/10 p-3">
						<div class="text-xs font-medium text-red-500">Instance needs attention</div>
						<p class="text-xs text-red-400">
							{#if isDiskFullError}
								{INSTANCE_DISK_FULL_MESSAGE}
							{:else}
								Try resetting your instance. This will fully restart it from scratch.
							{/if}
						</p>
						<button
							type="button"
							class="bc-btn bc-btn-primary text-xs"
							onclick={() => runAction('reset')}
							disabled={!canReset || isTransitioning || pendingAction !== null}
						>
							{#if pendingAction === 'reset'}
								<Loader2 size={12} class="animate-spin" />
								Resetting...
							{:else}
								<RotateCcw size={12} />
								Reset instance
							{/if}
						</button>
						<p class="text-[10px] text-red-400/70">If this doesn't work, please contact support.</p>
					</div>
				{/if}
				<div class="flex flex-col gap-2">
					<button
						type="button"
						class="bc-btn"
						onclick={() => runAction('wake')}
						disabled={!canWake || isTransitioning || pendingAction !== null}
					>
						{#if pendingAction === 'wake'}
							<Loader2 size={12} class="animate-spin" />
							Waking...
						{:else}
							<Play size={12} />
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
							<Loader2 size={12} class="animate-spin" />
							Stopping...
						{:else}
							<Square size={12} />
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
							<Loader2 size={12} class="animate-spin" />
							Updating...
						{:else}
							<RefreshCcw size={12} />
							Update packages
						{/if}
					</button>
				</div>
				{#if instanceStore.error || instanceStore.instance?.errorMessage}
					<div class="mt-2 flex items-start gap-2 text-xs text-red-500">
						<AlertTriangle size={12} />
						<span>
							{isDiskFullError
								? INSTANCE_DISK_FULL_MESSAGE
								: (instanceStore.error ?? instanceStore.instance?.errorMessage)}
						</span>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>
