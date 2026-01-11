<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';

	let { text, label } = $props<{ text: string; label?: string }>();

	let copied = $state(false);

	const copy = async () => {
		await navigator.clipboard.writeText(text);
		copied = true;
		window.setTimeout(() => {
			copied = false;
		}, 1400);
	};
</script>

<button
	type="button"
	class="bc-iconBtn"
	class:bc-copied={copied}
	onclick={copy}
	aria-label={label ?? 'Copy to clipboard'}
	title={label ?? 'Copy'}
>
	{#if copied}
		<Check size={16} strokeWidth={2.25} class="text-[color:hsl(var(--bc-accent-2))]" />
	{:else}
		<Copy size={16} strokeWidth={2.25} />
	{/if}
</button>
