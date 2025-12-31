<script lang="ts">
	import CopyButton from '$lib/CopyButton.svelte';
	import { getShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { getThemeStore } from '$lib/stores/ThemeStore.svelte';

	const commands = [
		{
			name: 'btca',
			description: 'Show version information.',
			example: 'btca'
		},
		{
			name: 'btca ask',
			description:
				'Ask a single question about configured resources and get an answer from their source code.',
			example: 'btca ask -r runed -q "How does useDebounce work?"'
		},
		{
			name: 'btca chat',
			description: 'Open an interactive TUI session for multi-turn conversations about resources.',
			example: 'btca chat -r runed'
		},
		{
			name: 'btca config',
			description: 'Display the path to the config file and available subcommands.',
			example: 'btca config'
		},
		{
			name: 'btca config model',
			description: 'View or set the AI model and provider used for answering questions.',
			example: 'btca config model -p anthropic -m claude-haiku-4-5'
		},
		{
			name: 'btca config resources list',
			description: 'List all configured resources (git repos or local paths) that btca can search.',
			example: 'btca config resources list'
		},
		{
			name: 'btca config resources add (git)',
			description: 'Add a new git repository as a resource.',
			example:
				'btca config resources add -n runed -t git -u https://github.com/svecosystem/runed -b main'
		},
		{
			name: 'btca config resources add (local)',
			description: 'Add a local directory as a resource.',
			example: 'btca config resources add -n myproject -t local --path /path/to/project'
		},
		{
			name: 'btca config resources remove',
			description: 'Remove a resource from the configuration.',
			example: 'btca config resources remove -n runed'
		},
		{
			name: 'btca config collections list',
			description: 'List all indexed collections.',
			example: 'btca config collections list'
		},
		{
			name: 'btca config collections clear',
			description: 'Clear all collections or a specific one with --key.',
			example: 'btca config collections clear'
		}
		// TODO: add these back later once threads are in a better state...
		// {
		// 	name: 'btca config threads list',
		// 	description: 'List all conversation threads.',
		// 	example: 'btca config threads list'
		// },
		// {
		// 	name: 'btca config threads delete',
		// 	description: 'Delete a conversation thread by ID.',
		// 	example: 'btca config threads delete --id abc123'
		// }
	] as const;

	const shikiStore = getShikiStore();
	const themeStore = getThemeStore();
	const shikiTheme = $derived(themeStore.theme === 'dark' ? 'dark-plus' : 'light-plus');
</script>

<section class="flex flex-col gap-10">
	<div class="flex flex-col gap-4">
		<div class="inline-flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
			<span
				class="inline-flex items-center rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-1 text-xs font-medium text-orange-700 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-300"
				>Reference</span
			>
			<span class="hidden sm:inline">Complete list of all available commands.</span>
		</div>

		<h1
			class="text-balance text-4xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50 sm:text-5xl"
		>
			Commands
		</h1>

		<p
			class="max-w-2xl text-pretty text-base leading-relaxed text-neutral-700 dark:text-neutral-300 sm:text-lg"
		>
			All available <code class="rounded bg-neutral-900/5 px-1.5 py-1 text-sm dark:bg-white/10"
				>btca</code
			> commands with descriptions and examples.
		</p>
	</div>

	<div class="flex flex-col gap-6">
		{#each commands as cmd}
			<div
				class="rounded-2xl border border-neutral-200 bg-white/70 p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/30"
			>
				<div class="flex flex-col gap-3">
					<div>
						<code
							class="rounded bg-neutral-900/5 px-2 py-1 text-sm font-semibold text-neutral-900 dark:bg-white/10 dark:text-neutral-50"
							>{cmd.name}</code
						>
					</div>
					<p class="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
						{cmd.description}
					</p>
					<div
						class="relative min-w-0 overflow-hidden rounded-xl border border-neutral-200 bg-white/70 dark:border-neutral-800 dark:bg-neutral-950/40"
					>
						<div class="flex items-center justify-between gap-3 p-4">
							<div class="min-w-0 flex-1 overflow-x-auto">
								{#if shikiStore.highlighter}
									{@html shikiStore.highlighter.codeToHtml(cmd.example, {
										theme: shikiTheme,
										lang: 'bash',
										rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
									})}
								{:else}
									<pre
										class="m-0 whitespace-pre text-sm leading-relaxed text-neutral-900 dark:text-neutral-50"><code
											>{cmd.example}</code
										></pre>
								{/if}
							</div>
							<CopyButton text={cmd.example} label="Copy command" />
						</div>
					</div>
				</div>
			</div>
		{/each}
	</div>
</section>
