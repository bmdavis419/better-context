<script lang="ts">
	import { XCircle } from '@lucide/svelte';
</script>

<div class="flex flex-1 items-center justify-center p-8">
	<div class="bc-card flex max-w-lg flex-col items-center gap-4 p-8 text-center">
		<div class="bc-logoMark h-12 w-12">
			<XCircle size={24} />
		</div>
		<h1 class="text-2xl font-semibold">Checkout canceled</h1>
		<p class="bc-muted text-sm">
			No worries - your card wasn't charged. You can restart checkout whenever you're ready.
		</p>
		<div class="flex gap-2">
			<a href="/pricing" class="bc-btn bc-btn-primary text-sm">Back to pricing</a>
			<a href="/" class="bc-btn text-sm">Go home</a>
		</div>
	</div>
</div>
