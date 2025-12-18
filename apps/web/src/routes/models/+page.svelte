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

<section class="flex flex-col gap-10">
	<div class="flex flex-col gap-4">
		<div class="inline-flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
			<span
				class="inline-flex items-center rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-1 text-xs font-medium text-orange-700 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-300"
				>Configuration</span
			>
			<span class="hidden sm:inline">Set your preferred AI model.</span>
		</div>

		<h1
			class="text-balance text-4xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50 sm:text-5xl"
		>
			Models
		</h1>

		<p
			class="max-w-2xl text-pretty text-base leading-relaxed text-neutral-700 dark:text-neutral-300 sm:text-lg"
		>
		Any model that works with OpenCode works with btca. Under the hood btca uses the OpenCode SDK, which will read your local config.
		</p>
	</div>

	<div class="flex flex-col gap-6">
		{#each BLESSED_MODELS as model}
			<div
				class="rounded-2xl border border-neutral-200 bg-white/70 p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/30"
			>
				<div class="flex flex-col gap-3">
					<div class="flex flex-wrap items-center gap-2">
						<code
							class="rounded bg-neutral-900/5 px-2 py-1 text-sm font-semibold text-neutral-900 dark:bg-white/10 dark:text-neutral-50"
							>{model.model}</code
						>
						<span
							class="rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400"
							>{model.provider}</span
						>
						{#if model.isDefault}
							<span
								class="rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-xs font-medium text-orange-700 dark:border-orange-500/25 dark:text-orange-300"
								>Default</span
							>
						{/if}
					</div>
					<p class="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
						{model.description}
					</p>
					<div
						class="relative min-w-0 overflow-hidden rounded-xl border border-neutral-200 bg-white/70 dark:border-neutral-800 dark:bg-neutral-950/40"
					>
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
									<pre
										class="m-0 whitespace-pre text-sm leading-relaxed text-neutral-900 dark:text-neutral-50"><code
											>{getCommand(model.provider, model.model)}</code
										></pre>
								{/if}
							</div>
							<CopyButton
								text={getCommand(model.provider, model.model)}
								label="Copy command to set this model"
							/>
						</div>
					</div>
					<a
						href={model.providerSetupUrl}
						target="_blank"
						rel="noreferrer"
						class="text-sm text-orange-600 hover:underline dark:text-orange-400"
					>
						Provider setup instructions &rarr;
					</a>
				</div>
			</div>
		{/each}
	</div>
</section>
