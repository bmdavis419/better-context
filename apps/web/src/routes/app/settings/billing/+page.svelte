<script lang="ts">
	import { Loader2, CreditCard, ExternalLink } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { useConvexClient } from 'convex-svelte';
	import { getAuthState } from '$lib/stores/auth.svelte';
	import { getBillingStore } from '$lib/stores/billing.svelte';
	import { BILLING_PLAN } from '$lib/billing/plans';
	import PricingPlans from '$lib/components/pricing/PricingPlans.svelte';
	import { api } from '../../../../convex/_generated/api';

	const auth = getAuthState();
	const billingStore = getBillingStore();
	const client = useConvexClient();

	let isRedirecting = $state(false);
	let errorMessage = $state<string | null>(null);

	const formattedEndDate = $derived.by(() => {
		const end = billingStore.summary?.currentPeriodEnd;
		if (!end) return null;
		return new Date(end).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	});

	const formattedCancelDate = $derived.by(() => {
		const canceledAt = billingStore.canceledAt;
		if (!canceledAt) return null;
		return new Date(canceledAt).toLocaleDateString(undefined, {
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

<div class="flex flex-1 overflow-hidden">
	<div class="mx-auto flex w-full max-w-5xl flex-col gap-8 overflow-y-auto p-8">
		<div>
			<h1 class="text-2xl font-semibold">Billing</h1>
			<p class="bc-muted mt-1 text-sm">Manage your subscription and payment details.</p>
		</div>

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
				<div class="bc-card bc-reveal p-5" style="--delay: 40ms">
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

				<div class="bc-card bc-reveal p-5" style="--delay: 80ms">
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

			<div class="bc-card bc-reveal p-5" style="--delay: 120ms">
				<div class="flex items-center justify-between gap-4">
					<div>
						<h3 class="font-medium">Manage subscription</h3>
						<p class="bc-muted text-xs">Update payment method, cancel, or view invoices.</p>
					</div>
					<button type="button" class="bc-btn" onclick={handleManage} disabled={isRedirecting}>
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
</div>
