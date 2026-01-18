<script lang="ts">
	import { Loader2, HardDrive } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { getAuthState } from '$lib/stores/auth.svelte';
	import { getBillingStore } from '$lib/stores/billing.svelte';
	import { SUPPORT_URL } from '$lib/billing/plans';
	import InstanceCard from '$lib/components/InstanceCard.svelte';

	const auth = getAuthState();
	const billingStore = getBillingStore();

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

	const formatPercent = (value: number | undefined) =>
		Number.isFinite(value) ? `${Math.round(value ?? 0)}%` : '0%';

	const tone = (remainingPct?: number) => {
		if (remainingPct == null) return 'hsl(var(--bc-accent))';
		if (remainingPct <= 10) return 'hsl(var(--bc-error))';
		if (remainingPct <= 25) return 'hsl(var(--bc-warning))';
		return 'hsl(var(--bc-accent))';
	};

	$effect(() => {
		if (!auth.isSignedIn && auth.isLoaded) {
			goto('/');
		}
	});
</script>

<div class="flex flex-1 overflow-hidden">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-8 overflow-y-auto p-8">
		<InstanceCard />
		<div>
			<h1 class="text-2xl font-semibold">Usage</h1>
			<p class="bc-muted mt-1 text-sm">Monthly usage resets automatically.</p>
		</div>

		{#if billingStore.isLoading}
			<div class="flex items-center justify-center py-12">
				<Loader2 size={28} class="animate-spin" />
			</div>
		{:else if !billingStore.isSubscribed}
			<div class="bc-card p-6">
				<p class="text-sm">
					No active subscription. <a href="/pricing">Subscribe to view usage</a>.
				</p>
			</div>
		{:else}
			<div class="bc-card bc-reveal p-5">
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
					<a href={SUPPORT_URL} target="_blank" rel="noreferrer">{SUPPORT_URL}</a> to raise them.
				</div>
			{/if}
		{/if}
	</div>
</div>
