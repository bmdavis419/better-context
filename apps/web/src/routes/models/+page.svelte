<script lang="ts">
	import CopyButton from '$lib/CopyButton.svelte';
	import { getShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { getThemeStore } from '$lib/stores/ThemeStore.svelte';
	import { BLESSED_MODELS } from '@btca/shared';

	const shikiStore = getShikiStore();
	const themeStore = getThemeStore();
	const shikiTheme = $derived(themeStore.theme === 'dark' ? 'dark-plus' : 'light-plus');

	const getCommand = (provider: string, model: string) =>
		`btca config model -p ${provider} -m ${model}`;
</script>

<section class="flex flex-col gap-14">
	<header class="flex flex-col gap-5">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Configuration</span>
			<span class="hidden sm:inline bc-muted">Pick a model. Keep the receipts.</span>
		</div>

		<h1 class="bc-h1 text-balance text-5xl sm:text-6xl">Models</h1>

		<p class="bc-prose max-w-2xl text-pretty text-base sm:text-lg">
			Any model that works with OpenCode works with btca. Under the hood btca uses the OpenCode SDK,
			which reads your local config.
		</p>
	</header>

	<div class="flex flex-col gap-4">
		{#each BLESSED_MODELS as model}
			<div class="bc-card bc-ring bc-cardHover p-6">
				<div class="flex flex-col gap-4">
					<div class="flex flex-wrap items-center gap-2">
						<code class="bc-tag">{model.model}</code>
						<span class="bc-badge">{model.provider}</span>
						{#if model.isDefault}
							<span class="bc-badge bc-badgeAccent">Default</span>
						{/if}
					</div>

					<p class="text-sm bc-prose">{model.description}</p>

					<div class="bc-codeFrame">
						<div class="flex items-center justify-between gap-3 p-4">
							<div class="min-w-0 flex-1 overflow-x-auto">
								{#if shikiStore.highlighter}
									{@html shikiStore.highlighter.codeToHtml(
										getCommand(model.provider, model.model),
										{
											theme: shikiTheme,
											lang: 'bash',
											rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
										}
									)}
								{:else}
									<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code
											>{getCommand(model.provider, model.model)}</code
										></pre>
								{/if}
							</div>
							<CopyButton text={getCommand(model.provider, model.model)} label="Copy command" />
						</div>
					</div>

					<a
						href={model.providerSetupUrl}
						target="_blank"
						rel="noreferrer"
						class="text-sm text-[color:hsl(var(--bc-accent))]"
					>
						Provider setup instructions →
					</a>
				</div>
			</div>
		{/each}
	</div>
</section>
