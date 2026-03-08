<script lang="ts">
	import { CheckCircle2 } from '@lucide/svelte';
	import { getBillingStore } from '$lib/stores/billing.svelte';
	import { onMount } from 'svelte';

	const billingStore = getBillingStore();

	onMount(() => {
		void billingStore.refetch();
	});
</script>

<div class="flex flex-1 items-center justify-center p-8">
	<div class="bc-card flex max-w-lg flex-col items-center gap-4 p-8 text-center">
		<div class="bc-logoMark h-12 w-12">
			<CheckCircle2 size={24} />
		</div>
		<h1 class="text-2xl font-semibold">You're subscribed</h1>
		<p class="bc-muted text-sm">Checkout complete. Your plan is now active and ready to use.</p>
		<div class="flex gap-2">
			<a href="/app/settings/usage" class="bc-btn bc-btn-primary text-sm">View usage</a>
			<a href="/app/chat/new" class="bc-btn text-sm">Start chatting</a>
		</div>
	</div>
</div>
