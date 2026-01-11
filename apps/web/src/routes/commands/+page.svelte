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
			example: 'btca config model -p opencode -m claude-haiku-4-5'
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

<section class="flex flex-col gap-14">
	<header class="flex flex-col gap-5">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Reference</span>
			<span class="hidden sm:inline bc-muted">Every command, one clean list</span>
		</div>

		<h1 class="bc-h1 text-balance text-5xl sm:text-6xl">Commands</h1>
		<p class="bc-prose max-w-2xl text-pretty text-base sm:text-lg">
			All available <code class="bc-inlineCode">btca</code> commands with descriptions and examples.
		</p>
	</header>

	<div class="flex flex-col gap-4">
		{#each commands as cmd}
			<div class="bc-card bc-ring bc-cardHover p-6">
				<div class="flex flex-col gap-4">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<code class="bc-tag">{cmd.name} </code>
						<div class="bc-badge">CLI</div>
					</div>

					<p class="text-sm bc-prose">{cmd.description}</p>

					<div class="bc-codeFrame">
						<div class="flex items-center justify-between gap-3 p-4">
							<div class="min-w-0 flex-1 overflow-x-auto">
								{#if shikiStore.highlighter}
									{@html shikiStore.highlighter.codeToHtml(cmd.example, {
										theme: shikiTheme,
										lang: 'bash',
										rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
									})}
								{:else}
									<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{cmd.example}</code
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
