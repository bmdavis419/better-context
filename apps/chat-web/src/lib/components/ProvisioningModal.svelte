<script lang="ts">
	import { CheckCircle2, Circle, Loader2, Server } from '@lucide/svelte';
	import { getInstanceStore } from '$lib/stores/instance.svelte';

	type Step = {
		title: string;
		description: string;
		isComplete: boolean;
		isActive: boolean;
	};

	const instanceStore = getInstanceStore();

	const isBootstrapping = $derived(instanceStore.isBootstrapping);
	const hasInstance = $derived(Boolean(instanceStore.instance));
	const instanceState = $derived(instanceStore.state ?? '');

	const isVisible = $derived.by(() => {
		if (instanceStore.isLoading) return false;
		if (isBootstrapping) return true;
		if (!hasInstance) return false;
		return instanceState === 'unprovisioned' || instanceState === 'provisioning';
	});

	const statusLabel = $derived.by(() => {
		if (isBootstrapping) return 'Setting up';
		switch (instanceState) {
			case 'unprovisioned':
				return 'Queued';
			case 'provisioning':
				return 'Provisioning';
			default:
				return 'Preparing';
		}
	});

	const hasInstanceRecord = $derived(hasInstance);
	const hasSandbox = $derived(Boolean(instanceStore.instance?.sandboxId));
	const hasProvisionedAt = $derived(Boolean(instanceStore.instance?.provisionedAt));
	const hasPackages = $derived(Boolean(instanceStore.btcaVersion || instanceStore.opencodeVersion));
	const hasServer = $derived(Boolean(instanceStore.instance?.serverUrl));

	const steps = $derived.by(() => {
		const items = [
			{
				title: 'Setting up account',
				description: 'Creating your instance record.',
				isComplete: hasInstanceRecord
			},
			{
				title: 'Creating sandbox',
				description: 'Reserving a dedicated runtime for your account.',
				isComplete: hasSandbox
			},
			{
				title: 'Installing packages',
				description: 'Downloading btca and opencode toolchains.',
				isComplete: hasPackages
			},
			{
				title: 'Finalizing setup',
				description: 'Locking in versions and preparing the instance.',
				isComplete: hasProvisionedAt
			}
		];
		const activeIndex = items.findIndex((item) => !item.isComplete);
		return items.map((item, index) => ({
			...item,
			isActive: activeIndex === -1 ? index === items.length - 1 : index === activeIndex
		}));
	}) as Step[];

	const completedSteps = $derived(steps.filter((step) => step.isComplete).length);
	const progressPercent = $derived.by(() => {
		if (!steps.length) return 0;
		const raw = (completedSteps / steps.length) * 100;
		return Math.min(100, Math.max(8, Math.round(raw)));
	});

	const progressCopy = $derived.by(() => {
		if (isBootstrapping) return 'Setting up your account...';
		if (completedSteps === 0) return 'Starting provisioning...';
		if (completedSteps < steps.length) return 'Provisioning in progress...';
		return 'Finalizing setup...';
	});
</script>

{#if isVisible}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--bc-bg))]/85 px-6 py-10 backdrop-blur-sm"
	>
		<div
			class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,116,51,0.18),_transparent_55%)]"
			aria-hidden="true"
		></div>
		<div
			class="bc-card bc-reveal relative w-full max-w-xl p-6 md:p-8"
			style="--delay: 20ms"
			role="dialog"
			aria-modal="true"
			aria-label="Provisioning your instance"
		>
			<div class="flex flex-wrap items-center gap-4">
				<div class="bc-logoMark">
					<Server size={18} />
				</div>
				<div class="min-w-0">
					<h2 class="text-lg font-semibold">Provisioning your instance</h2>
					<p class="bc-muted text-sm">This happens once for new accounts. Keep this tab open.</p>
				</div>
				<div class="ml-auto flex items-center gap-2 text-xs font-semibold">
					<Loader2 size={14} class="animate-spin text-[hsl(var(--bc-accent))]" />
					<span class="text-[hsl(var(--bc-accent))]">{statusLabel}</span>
				</div>
			</div>

			<div class="mt-6" aria-live="polite">
				<div class="flex items-center justify-between text-xs">
					<span class="bc-muted">{progressCopy}</span>
					<span class="font-semibold">{progressPercent}%</span>
				</div>
				<div
					class="mt-2 h-2 w-full border border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface))]"
				>
					<div
						class="h-full bg-[hsl(var(--bc-accent))] transition-all duration-300"
						style={`width: ${progressPercent}%`}
					></div>
				</div>
			</div>

			<div class="mt-6 grid gap-3">
				{#each steps as step}
					<div
						class="flex items-start gap-3 border border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface-2))] px-4 py-3"
					>
						<div
							class={`mt-0.5 flex h-6 w-6 items-center justify-center border ${step.isComplete ? 'border-[hsl(var(--bc-success))] text-[hsl(var(--bc-success))]' : step.isActive ? 'border-[hsl(var(--bc-accent))] text-[hsl(var(--bc-accent))]' : 'border-[hsl(var(--bc-border))] text-[hsl(var(--bc-fg-muted))]'}`}
						>
							{#if step.isComplete}
								<CheckCircle2 size={14} />
							{:else if step.isActive}
								<Loader2 size={14} class="animate-spin" />
							{:else}
								<Circle size={12} />
							{/if}
						</div>
						<div>
							<div class="text-sm font-semibold">{step.title}</div>
							<div class="bc-muted text-xs">{step.description}</div>
						</div>
					</div>
				{/each}
			</div>

			<p class="bc-muted mt-4 text-xs">
				We will close this once provisioning completes. You can keep exploring in another tab.
			</p>
		</div>
	</div>
{/if}
