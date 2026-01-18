<script lang="ts">
	import { Check, Loader2, Sparkles } from '@lucide/svelte';
	import { getAuthState, openSignIn } from '$lib/stores/auth.svelte';
	import { getBillingStore } from '$lib/stores/billing.svelte';
	import { remoteCreateCheckoutSession } from '$lib/remote/billing.remote';
	import { BILLING_PLAN, SUPPORT_URL } from '$lib/billing/plans';

	const auth = getAuthState();
	const billingStore = getBillingStore();

	let isRedirecting = $state(false);
	let errorMessage = $state<string | null>(null);

	const features = [
		'Claude Haiku 4.5 model tuned for docs QA',
		'Dedicated Daytona sandbox per session',
		'MCP access with API keys',
		'Monthly usage budget across tokens + sandbox time',
		'Priority support via X'
	];

	async function handleCheckout() {
		errorMessage = null;
		if (!auth.isSignedIn || !auth.instanceId) {
			openSignIn('/pricing');
			return;
		}
		isRedirecting = true;
		try {
			const result = await remoteCreateCheckoutSession({ userId: auth.instanceId });
			window.location.href = result.url;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to start checkout';
		} finally {
			isRedirecting = false;
		}
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<div class="bc-container flex w-full flex-col gap-10 overflow-y-auto py-10">
		<section class="bc-card bc-reveal relative overflow-hidden p-10" style="--delay: 40ms">
			<div
				class="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,116,51,0.18),_transparent_55%)]"
			></div>
			<div class="relative z-10 flex flex-col gap-6">
				<div class="flex items-center gap-3">
					<div class="bc-logoMark">
						<Sparkles size={20} />
					</div>
					<span class="bc-badge">Pro Plan</span>
				</div>
				<div class="max-w-2xl">
					<h1 class="text-4xl font-semibold tracking-tight">One plan. Built to stay fast.</h1>
					<p class="bc-muted mt-3 text-base">
						Ship with Haiku 4.5, fresh sandboxes, and predictable usage budgets. Everything you need
						to keep btca reliable.
					</p>
				</div>
			</div>
		</section>

		<section class="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
			<div class="bc-card bc-reveal p-8" style="--delay: 90ms">
				<h2 class="text-xl font-semibold">What you get</h2>
				<ul class="mt-4 grid gap-3">
					{#each features as feature}
						<li class="flex items-start gap-3">
							<Check size={18} class="mt-0.5 text-[hsl(var(--bc-success))]" />
							<span class="text-sm">{feature}</span>
						</li>
					{/each}
				</ul>
				<div
					class="bc-card mt-6 border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface-2))] p-4 text-xs"
				>
					Usage is enforced monthly across tokens in/out and sandbox hours. You'll only see
					percentages, never raw counts.
				</div>
			</div>

			<div class="bc-card bc-reveal p-8" style="--delay: 130ms">
				<div class="flex items-baseline justify-between">
					<div>
						<p class="bc-muted text-xs uppercase tracking-[0.3em]">Monthly</p>
						<h3 class="mt-2 text-3xl font-semibold">${BILLING_PLAN.priceUsd}</h3>
						<p class="bc-muted text-xs">per month</p>
					</div>
					<span class="bc-badge">Cancel anytime</span>
				</div>

				<div class="mt-6 flex flex-col gap-3 text-sm">
					<div class="flex justify-between">
						<span class="bc-muted">Model</span>
						<span>{BILLING_PLAN.model}</span>
					</div>
					<div class="flex justify-between">
						<span class="bc-muted">Sandbox</span>
						<span>Daytona</span>
					</div>
					<div class="flex justify-between">
						<span class="bc-muted">Support</span>
						<a href={SUPPORT_URL} target="_blank" rel="noreferrer" class="underline"> @davis7 </a>
					</div>
				</div>

				{#if errorMessage}
					<p class="mt-4 text-xs text-red-500">{errorMessage}</p>
				{/if}

				{#if billingStore.isSubscribed}
					<a href="/settings/usage" class="bc-btn bc-btn-primary mt-6 w-full">View usage</a>
				{:else}
					<button
						type="button"
						class="bc-btn bc-btn-primary mt-6 w-full"
						onclick={handleCheckout}
						disabled={isRedirecting}
					>
						{#if isRedirecting}
							<Loader2 size={16} class="animate-spin" />
							Starting checkout...
						{:else}
							Subscribe now
						{/if}
					</button>
				{/if}
			</div>
		</section>
	</div>
</div>
