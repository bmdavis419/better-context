<script lang="ts">
	import type { BtcaChunk } from '$lib/types';

	interface Props {
		chunks: BtcaChunk[];
	}

	let { chunks }: Props = $props();

	const summaryItems = $derived.by(() => {
		const counts = new Map<string, number>();
		const order: string[] = [];

		for (const chunk of chunks) {
			if (chunk.type !== 'tool') continue;
			const name = chunk.toolName;
			if (!counts.has(name)) {
				counts.set(name, 0);
				order.push(name);
			}
			counts.set(name, (counts.get(name) ?? 0) + 1);
		}

		return order.map((name) => ({ name, count: counts.get(name) ?? 0 }));
	});
</script>

{#if summaryItems.length > 0}
	<div class="tool-summary">
		<span class="tool-summary-label">Tools</span>
		<div class="tool-summary-items">
			{#each summaryItems as item, index}
				<span class="tool-summary-item">{item.name} ×{item.count}</span>
				{#if index < summaryItems.length - 1}
					<span class="tool-summary-sep">|</span>
				{/if}
			{/each}
		</div>
	</div>
{/if}
