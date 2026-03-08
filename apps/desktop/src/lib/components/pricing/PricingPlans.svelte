<script lang="ts">
	import { Check, Loader2, Sparkles } from '@lucide/svelte';
	import { BILLING_PLAN } from '$lib/billing/plans';

	type Props = {
		isSubscribed?: boolean;
		isSignedIn?: boolean;
		onCheckout?: () => void | Promise<void>;
		onSignIn?: () => void;
		checkoutRedirectPath?: string;
		usageHref?: string;
		isRedirecting?: boolean;
		errorMessage?: string | null;
	};

	let {
		isSubscribed = false,
		isSignedIn = false,
		onCheckout,
		onSignIn,
		usageHref = '/app/settings/usage',
		isRedirecting = false,
		errorMessage = null
	}: Props = $props();

	const features = [
		'Choose between low, balanced, and high-end models',
		'Shared monthly AI usage across all web models',
		'Dedicated sandbox for cloud repo work',
		'Saved threads and project organization',
		'Cloud MCP for coding tools',
		'Priority support'
	];

	function handleAction() {
		if (!isSignedIn && onSignIn) {
			onSignIn();
			return;
		}
		if (onCheckout) {
			void onCheckout();
		}
	}
</script>

<div class="flex w-full flex-col gap-10">
	<section class="bc-card bc-reveal relative overflow-hidden p-10" style="--delay: 40ms">
		<div
			class="absolute inset-0 bg-[radial-gradient(circle_at_top,_hsl(var(--bc-accent)/0.22),_transparent_55%)]"
		></div>
		<div class="relative z-10 flex flex-col gap-6">
			<div class="flex items-center gap-3">
				<div class="bc-logoMark">
					<Sparkles size={20} />
				</div>
				<span class="bc-badge">Pro Plan</span>
			</div>
			<div class="max-w-2xl">
				<h1 class="text-4xl font-semibold tracking-tight">
					For developers who want grounded answers from real codebases
				</h1>
				<p class="bc-muted mt-3 text-base">
					Search repos, save threads, and use btca as your codebase research layer.
				</p>
			</div>
		</div>
	</section>

	<section class="grid gap-6 lg:grid-cols-2">
		<div class="bc-card bc-reveal p-8" style="--delay: 60ms">
			<div class="flex items-baseline justify-between">
				<div>
					<p class="bc-muted text-xs tracking-[0.3em] uppercase">Free</p>
					<h3 class="mt-2 text-3xl font-semibold">$0</h3>
					<p class="bc-muted text-xs">forever</p>
				</div>
				<span class="bc-badge">Try btca</span>
			</div>
			<p class="mt-4 text-sm font-medium">Try btca on a real codebase</p>
			<ul class="mt-6 grid gap-3 text-sm">
				<li class="flex items-start gap-3">
					<Check size={18} class="mt-0.5 text-[hsl(var(--bc-success))]" />
					<span>Limited messages to test the workflow</span>
				</li>
				<li class="flex items-start gap-3">
					<Check size={18} class="mt-0.5 text-[hsl(var(--bc-success))]" />
					<span>Grounded codebase search</span>
				</li>
				<li class="flex items-start gap-3">
					<Check size={18} class="mt-0.5 text-[hsl(var(--bc-success))]" />
					<span>Pick from low, balanced, and high-end web models</span>
				</li>
			</ul>
			<div
				class="bc-card mt-6 border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface-2))] p-4 text-xs"
			>
				Good for evaluating the product before you commit to a paid workflow.
			</div>
		</div>

		<div class="bc-card bc-reveal p-8" style="--delay: 90ms">
			<div class="flex items-baseline justify-between">
				<div>
					<p class="bc-muted text-xs tracking-[0.3em] uppercase">Pro</p>
					<h3 class="mt-2 text-3xl font-semibold">${BILLING_PLAN.priceUsd}</h3>
					<p class="bc-muted text-xs">per month</p>
				</div>
				<span class="bc-badge">Cancel anytime</span>
			</div>
			<p class="mt-4 text-sm font-medium">For solo developers doing ongoing codebase research</p>
			<ul class="mt-6 grid gap-3 text-sm">
				{#each features as feature}
					<li class="flex items-start gap-3">
						<Check size={18} class="mt-0.5 text-[hsl(var(--bc-success))]" />
						<span>{feature}</span>
					</li>
				{/each}
			</ul>
			<div
				class="bc-card mt-6 border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface-2))] p-4 text-xs"
			>
				Monthly AI usage is shared across all models. Higher-end models use it faster.
			</div>
			{#if errorMessage}
				<p class="mt-4 text-xs text-red-500">{errorMessage}</p>
			{/if}
			{#if isSubscribed}
				<a href={usageHref} class="bc-btn bc-btn-primary mt-6 w-full">View usage</a>
			{:else}
				<button
					type="button"
					class="bc-btn bc-btn-primary mt-6 w-full"
					onclick={handleAction}
					disabled={isRedirecting}
				>
					{#if isRedirecting}
						<Loader2 size={16} class="animate-spin" />
						Starting checkout...
					{:else if !isSignedIn}
						Start with Free
					{:else}
						Upgrade to Pro
					{/if}
				</button>
			{/if}
		</div>
	</section>
</div>
