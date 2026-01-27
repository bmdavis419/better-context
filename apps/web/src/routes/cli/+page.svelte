<script lang="ts">
	import CopyButton from '$lib/CopyButton.svelte';
	import { getShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { getThemeStore } from '$lib/stores/theme.svelte';
	import SETUP_PROMPT_RAW from '$lib/assets/docs/SETUP_PROMPT.md?raw';

	const INSTALL_CMD = 'bun add -g btca opencode-ai';
	const RESOURCE_ADD_CMD =
		'btca config resources add --name convex --type git --url https://github.com/get-convex/convex-js --branch main';
	const QUICK_START_CMD =
		'btca ask --resource convex --question "How do I create a Convex mutation and use it in a React app?"';
	const CURSOR_RULE_CMD = `mkdir -p .cursor/rules && curl -fsSL "https://btca.dev/rule" -o .cursor/rules/better_context.mdc && echo "Rule file created."`;

	const commands = [
		{
			name: 'btca',
			description: 'Launch the interactive TUI for multi-turn questions.',
			example: 'btca'
		},
		{
			name: 'btca ask',
			description: 'Ask a single question about configured resources.',
			example: 'btca ask --resource svelte --question "How does $state work?"'
		},
		{
			name: 'btca chat',
			description: 'Open a TUI session with saved history.',
			example: 'btca chat --resource svelte'
		},
		{
			name: 'btca serve',
			description: 'Start the local server for HTTP requests.',
			example: 'btca serve --port 3000'
		}
	] as const;

	const configExample = `// Add a btca.config.jsonc file in your project to pin specific resources.
{
  "$schema": "https://btca.dev/btca.schema.json", // JSON schema for editor validation.
  "baseDir": ".btca", // Base directory for cache and local data.
  "model": "claude-haiku-4-5", // Default model used for completions.
  "provider": "opencode", // Provider for model access.
  "resources": [ // Repositories btca can search.
    {
      "type": "git", // Resource type (git repository).
      "name": "svelte", // Short name used in CLI commands.
      "url": "https://github.com/sveltejs/svelte.dev", // Repo URL to clone.
      "branch": "main", // Branch to search.
      "searchPath": "apps/svelte.dev" // Subdirectory to focus on.
    }
  ]
}`;

	const shikiStore = getShikiStore();
	const themeStore = getThemeStore();
	const shikiTheme = $derived(themeStore.theme === 'dark' ? 'dark-plus' : 'light-plus');
	const SETUP_PROMPT =
		SETUP_PROMPT_RAW.split('## Detailed Instructions')[1]?.split('---')[1]?.trim() ?? '';
</script>

<svelte:head>
	<title>btca | CLI</title>
	<meta
		name="description"
		content="Install btca, add a resource, and run your first CLI question."
	/>
</svelte:head>

<section class="flex flex-col gap-14">
	<header class="flex flex-col gap-5">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>CLI</span>
		</div>

		<h1 class="bc-h1 text-balance text-5xl sm:text-6xl">Ship answers from the real source.</h1>
		<p class="bc-prose max-w-2xl text-pretty text-base sm:text-lg">
			The CLI clones repos locally, searches code, and returns citations. It is fast, private, and
			terminal-first.
		</p>
	</header>

	<section class="flex flex-col gap-4">
		<div class="bc-card bc-ring p-5">
			<div class="text-sm font-semibold">Step 1 · Install</div>
			<p class="mt-2 text-sm bc-prose">Install btca and the OpenCode SDK globally.</p>
			<div class="mt-4 bc-codeFrame">
				<div class="flex items-center justify-between gap-3 p-4">
					<div class="min-w-0 flex-1 overflow-x-auto">
						{#if shikiStore.highlighter}
							{@html shikiStore.highlighter.codeToHtml(INSTALL_CMD, {
								theme: shikiTheme,
								lang: 'bash',
								rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
							})}
						{:else}
							<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{INSTALL_CMD}</code
								></pre>
						{/if}
					</div>
					<CopyButton text={INSTALL_CMD} label="Copy install command" />
				</div>
			</div>
		</div>

		<div class="bc-card bc-ring p-5">
			<div class="text-sm font-semibold">Step 2 · Add a resource</div>
			<p class="mt-2 text-sm bc-prose">
				Add the Convex JS repo as your first resource.
				<a href="https://github.com/get-convex/convex-js" target="_blank" rel="noreferrer"
					>View repo</a
				>.
			</p>
			<div class="mt-4 bc-codeFrame">
				<div class="flex items-center justify-between gap-3 p-4">
					<div class="min-w-0 flex-1 overflow-x-auto">
						{#if shikiStore.highlighter}
							{@html shikiStore.highlighter.codeToHtml(RESOURCE_ADD_CMD, {
								theme: shikiTheme,
								lang: 'bash',
								rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
							})}
						{:else}
							<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{RESOURCE_ADD_CMD}</code
								></pre>
						{/if}
					</div>
					<CopyButton text={RESOURCE_ADD_CMD} label="Copy resource command" />
				</div>
			</div>
		</div>

		<div class="bc-card bc-ring p-5">
			<div class="text-sm font-semibold">Step 3 · Ask a question</div>
			<p class="mt-2 text-sm bc-prose">Use the resource to see a real answer.</p>
			<div class="mt-4 bc-codeFrame">
				<div class="flex items-center justify-between gap-3 p-4">
					<div class="min-w-0 flex-1 overflow-x-auto">
						{#if shikiStore.highlighter}
							{@html shikiStore.highlighter.codeToHtml(QUICK_START_CMD, {
								theme: shikiTheme,
								lang: 'bash',
								rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
							})}
						{:else}
							<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{QUICK_START_CMD}</code
								></pre>
						{/if}
					</div>
					<CopyButton text={QUICK_START_CMD} label="Copy quick start command" />
				</div>
			</div>
		</div>
	</section>

	<section>
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Project setup</span>
		</div>

		<div class="mt-2 bc-card bc-ring p-5">
			<div class="text-sm font-semibold">Add Cursor rules</div>
			<p class="mt-2 text-sm bc-prose">
				Use this command to pull the Cursor rules into your project.
			</p>
			<div class="mt-4 bc-codeFrame">
				<div class="flex items-center justify-between gap-3 p-4">
					<div class="min-w-0 flex-1 overflow-x-auto">
						{#if shikiStore.highlighter}
							{@html shikiStore.highlighter.codeToHtml(CURSOR_RULE_CMD, {
								theme: shikiTheme,
								lang: 'bash',
								rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
							})}
						{:else}
							<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{CURSOR_RULE_CMD}</code
								></pre>
						{/if}
					</div>
					<CopyButton text={CURSOR_RULE_CMD} label="Copy quick start command" />
				</div>
			</div>
		</div>
		<p class="mt-4 max-w-2xl text-sm bc-prose">
			Copy this prompt into your AI coding agent to generate a tailored
			<code class="bc-inlineCode">btca.config.jsonc</code> for your repo.
		</p>

		<div class="mt-4 bc-card bc-ring p-5">
			<div class="flex items-center justify-between gap-3 mb-3">
				<div class="text-sm font-semibold">Setup Prompt</div>
				<CopyButton text={SETUP_PROMPT} label="Copy prompt" />
			</div>

			<div class="bc-codeFrame max-h-96 overflow-y-auto">
				<div class="p-4">
					<pre
						class="m-0 whitespace-pre-wrap text-sm leading-relaxed text-[color:hsl(var(--bc-fg))]">{SETUP_PROMPT}</pre>
				</div>
			</div>
		</div>
	</section>

	<section>
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Commands</span>
		</div>
		<p class="mt-2 max-w-2xl text-sm bc-prose">The core CLI workflows, ready to copy.</p>

		<div class="mt-4 grid gap-4 lg:grid-cols-2">
			{#each commands as cmd}
				<div class="bc-card bc-ring bc-cardHover p-5">
					<div class="flex flex-wrap items-center gap-2">
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

	<section>
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Configuration</span>
		</div>
		<p class="mt-2 max-w-2xl text-sm bc-prose">
			Add resources and model details in <code class="bc-inlineCode">btca.config.jsonc</code>. You
			can place this in your project to define exactly what btca should search.
		</p>

		<div class="mt-4 bc-card bc-ring p-5">
			<div class="flex items-center justify-between gap-3">
				<div class="text-sm font-semibold">Example config</div>
				<CopyButton text={configExample} label="Copy config" />
			</div>
			<div class="mt-3 bc-codeFrame">
				<div class="p-4">
					{#if shikiStore.highlighter}
						{@html shikiStore.highlighter.codeToHtml(configExample, {
							theme: shikiTheme,
							lang: 'json',
							rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
						})}
					{:else}
						<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{configExample}</code
							></pre>
					{/if}
				</div>
			</div>
		</div>

		<div class="mt-4 flex flex-wrap gap-3">
			<a href="/resources" class="bc-chip">Browse curated resources</a>
			<a href="/config" class="bc-chip">Advanced configuration</a>
		</div>
	</section>
</section>
