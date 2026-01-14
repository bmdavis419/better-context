<script lang="ts">
	import CopyButton from '$lib/CopyButton.svelte';
	import { getShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { getThemeStore } from '$lib/stores/ThemeStore.svelte';

	const commands = [
		{
			name: 'btca',
			description: 'Launch the interactive TUI. Default action when no subcommand is provided.',
			example: 'btca'
		},
		{
			name: 'btca ask',
			description: 'Ask a single question about configured resources.',
			example: 'btca ask --resource svelte --question "How does $state work?"'
		},
		{
			name: 'btca chat',
			description: 'Open an interactive TUI session for multi-turn conversations.',
			example: 'btca chat --resource svelte'
		},
		{
			name: 'btca serve',
			description: 'Start the btca server and listen for HTTP requests.',
			example: 'btca serve --port 3000'
		},
		{
			name: 'btca config model',
			description: 'Set the AI model and provider.',
			example: 'btca config model --provider opencode --model claude-haiku-4-5'
		},
		{
			name: 'btca config resources list',
			description: 'List all configured resources.',
			example: 'btca config resources list'
		},
		{
			name: 'btca config resources add',
			description: 'Add a new git repository as a resource.',
			example:
				'btca config resources add --name effect --type git --url https://github.com/Effect-TS/effect --branch main'
		},
		{
			name: 'btca config resources remove',
			description: 'Remove a resource from the configuration.',
			example: 'btca config resources remove --name effect'
		},
		{
			name: 'btca clear',
			description: 'Clear all of the locally cloned resources',
			example: 'btca clear'
		}
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
		</div>

		<h1 class="bc-h1 text-balance text-5xl sm:text-6xl">Commands</h1>
		<p class="bc-prose max-w-2xl text-pretty text-base sm:text-lg">
			All available <code class="bc-inlineCode">btca</code> commands.
		</p>
	</header>

	<div class="flex flex-col gap-4">
		{#each commands as cmd}
			<div class="bc-card bc-ring bc-cardHover p-5">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<code class="bc-tag">{cmd.name}</code>
				</div>

				<p class="mt-2 text-sm bc-prose">{cmd.description}</p>

				<div class="mt-3 bc-codeFrame">
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
		{/each}
	</div>
</section>
