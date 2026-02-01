<script lang="ts">
	import CopyButton from '$lib/CopyButton.svelte';
	import { getShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { getThemeStore } from '$lib/stores/theme.svelte';
	import { BLESSED_MODELS } from '@btca/shared';

	const shikiStore = getShikiStore();
	const themeStore = getThemeStore();
	const shikiTheme = $derived(themeStore.theme === 'dark' ? 'dark-plus' : 'light-plus');

	const CONFIG_EXAMPLE = `{
  "$schema": "https://btca.dev/btca.schema.json",
  "dataDirectory": ".btca",
  "model": "claude-haiku-4-5",
  "provider": "opencode",
  "providerTimeoutMs": 300000,
  "resources": [
    {
      "type": "git",
      "name": "svelte",
      "url": "https://github.com/sveltejs/svelte.dev",
      "branch": "main",
      "searchPath": "apps/svelte.dev",
      "specialNotes": "Focus on the content directory for docs"
    },
    {
      "type": "git",
      "name": "effect",
      "url": "https://github.com/Effect-TS/effect",
      "branch": "main"
    }
  ]
}`;

	const AGENTS_MD_SNIPPET = `## btca

When the user says "use btca" for codebase/docs questions.

Run:
- btca ask -r <resource> -q "<question>"

Available resources: svelte, effect`;

	const getModelCommand = (provider: string, model: string) =>
		`btca config model -p ${provider} -m ${model}`;

	const RESOURCE_ADD_CMD = `btca config resources add -n effect -t git -u https://github.com/Effect-TS/effect -b main`;

	const PROVIDER_AUTH = [
		{
			id: 'opencode',
			title: 'OpenCode Zen',
			authType: 'API key',
			description: 'Use an OpenCode Zen API key to access curated models.',
			link: 'https://opencode.ai/zen',
			linkLabel: 'Get OpenCode Zen API key',
			steps: ['Run btca connect', 'Select OpenCode Zen', 'Paste your API key']
		},
		{
			id: 'openrouter',
			title: 'OpenRouter',
			authType: 'API key',
			description: 'Use an OpenRouter API key for OpenRouter-hosted models.',
			link: 'https://openrouter.ai/settings/keys',
			linkLabel: 'Get OpenRouter API key',
			steps: ['Run btca connect', 'Select OpenRouter', 'Paste your API key']
		},
		{
			id: 'openai',
			title: 'OpenAI',
			authType: 'OAuth (ChatGPT subscription)',
			description: 'Sign in with OAuth; btca reuses your existing ChatGPT subscription.',
			link: 'https://chatgpt.com',
			linkLabel: 'Open ChatGPT',
			steps: ['Run btca connect', 'Select OpenAI', 'Complete the browser sign-in']
		},
		{
			id: 'google',
			title: 'Google',
			authType: 'API key',
			description: 'Use a Google AI Studio API key for Gemini models.',
			link: 'https://aistudio.google.com/api-keys',
			linkLabel: 'Get Google API key',
			steps: ['Run btca connect', 'Select Google', 'Paste your API key']
		},
		{
			id: 'anthropic',
			title: 'Anthropic',
			authType: 'API key',
			description: 'Use an Anthropic API key for Claude models.',
			link: 'https://platform.claude.com/dashboard',
			linkLabel: 'Get Anthropic API key',
			steps: ['Run btca connect', 'Select Anthropic', 'Paste your API key']
		}
	];
</script>

<section class="flex flex-col gap-14">
	<header class="flex flex-col gap-5">
		<div class="bc-kicker bc-reveal" style="--delay: 0ms">
			<span class="bc-kickerDot"></span>
			<span>Configuration</span>
		</div>

		<h1 class="bc-h1 text-balance text-5xl sm:text-6xl bc-reveal" style="--delay: 90ms">
			Set up <span class="text-[hsl(var(--bc-accent))]">btca</span>
		</h1>

		<p class="bc-prose max-w-2xl text-pretty text-base sm:text-lg bc-reveal" style="--delay: 160ms">
			Configure models and add resources to your config file.
		</p>
	</header>

	<section id="config-file" class="scroll-mt-28">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Config file</span>
		</div>

		<p class="mt-2 max-w-2xl text-sm bc-prose">btca looks for config in two places:</p>

		<div class="mt-4 grid gap-4 md:grid-cols-2">
			<div class="bc-card bc-ring p-5">
				<div class="text-sm font-semibold">Global config</div>
				<p class="mt-2 text-sm bc-prose">Default location, used when no project config exists.</p>
				<code class="mt-3 block bc-inlineCode text-xs">~/.config/btca/btca.config.jsonc</code>
			</div>

			<div class="bc-card bc-ring p-5">
				<div class="text-sm font-semibold">Project config</div>
				<p class="mt-2 text-sm bc-prose">Place in your project root to override global config.</p>
				<code class="mt-3 block bc-inlineCode text-xs">./btca.config.jsonc</code>
			</div>
		</div>

		<p class="mt-4 text-sm bc-prose">
			On first run, btca creates a default global config with some starter resources. Use
			<code class="bc-inlineCode">dataDirectory</code> to control where btca stores resources and collections.
		</p>
	</section>

	<section id="models" class="scroll-mt-28">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Models</span>
		</div>

		<p class="mt-2 max-w-2xl text-sm bc-prose">
			btca supports five providers: OpenCode, OpenRouter, OpenAI, Google, and Anthropic. Choose a
			model via CLI or edit the config file directly.
		</p>
		<p class="mt-2 max-w-2xl text-sm bc-prose">
			Run <code class="bc-inlineCode">btca connect</code> to authenticate a provider and pick from the
			curated models below.
		</p>

		<div class="mt-4 flex flex-col gap-4">
			{#each BLESSED_MODELS as model}
				<div class="bc-card bc-ring bc-cardHover p-5">
					<div class="flex flex-wrap items-center gap-2">
						<code class="bc-tag">{model.model}</code>
						<span class="bc-badge">{model.provider}</span>
						{#if model.isDefault}
							<span class="bc-badge bc-badgeAccent">Default</span>
						{/if}
					</div>

					<p class="mt-2 text-sm bc-prose">{model.description}</p>

					<div class="mt-3 bc-codeFrame">
						<div class="flex items-center justify-between gap-3 p-4">
							<div class="min-w-0 flex-1 overflow-x-auto">
								{#if shikiStore.highlighter}
									{@html shikiStore.highlighter.codeToHtml(
										getModelCommand(model.provider, model.model),
										{
											theme: shikiTheme,
											lang: 'bash',
											rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
										}
									)}
								{:else}
									<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code
											>{getModelCommand(model.provider, model.model)}</code
										></pre>
								{/if}
							</div>
							<CopyButton
								text={getModelCommand(model.provider, model.model)}
								label="Copy command"
							/>
						</div>
					</div>

					<a
						href={model.providerSetupUrl}
						target="_blank"
						rel="noreferrer"
						class="mt-3 inline-block text-sm text-[hsl(var(--bc-accent))]"
					>
						Provider setup instructions
					</a>
				</div>
			{/each}
		</div>
	</section>

	<section id="provider-auth" class="scroll-mt-28">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Provider auth</span>
		</div>

		<p class="mt-2 max-w-2xl text-sm bc-prose">
			Supported providers are limited to OpenCode, OpenRouter, OpenAI, Google, and Anthropic.
		</p>

		<div class="mt-4 grid gap-4 md:grid-cols-2">
			{#each PROVIDER_AUTH as provider}
				<div class="bc-card bc-ring p-5">
					<div class="flex flex-wrap items-center gap-2">
						<div class="text-sm font-semibold">{provider.title}</div>
						<span class="bc-badge">{provider.authType}</span>
					</div>
					<p class="mt-2 text-sm bc-prose">{provider.description}</p>
					<ul class="mt-3 list-disc pl-5 text-xs text-[hsl(var(--bc-muted))]">
						{#each provider.steps as step}
							<li>{step}</li>
						{/each}
					</ul>
					<a
						href={provider.link}
						target="_blank"
						rel="noreferrer"
						class="mt-3 inline-flex items-center gap-1 text-sm text-[hsl(var(--bc-accent))]"
					>
						<span>{provider.linkLabel}</span>
					</a>
				</div>
			{/each}
		</div>

		<p class="mt-4 text-xs bc-prose">
			Want another provider? <a
				href="https://github.com/davis7dotsh/better-context/issues"
				target="_blank"
				rel="noreferrer"
				class="text-[hsl(var(--bc-accent))]"
			>
				Open an issue
			</a>
			to request it.
		</p>
	</section>

	<section id="resources" class="scroll-mt-28">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Resources</span>
		</div>

		<p class="mt-2 max-w-2xl text-sm bc-prose">
			Resources are git repositories or local directories that btca indexes. Add them via CLI or
			edit the config file directly.
		</p>

		<div class="mt-4 bc-card bc-ring p-5">
			<div class="text-sm font-semibold">Add a resource via CLI</div>
			<div class="mt-3 bc-codeFrame">
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
					<CopyButton text={RESOURCE_ADD_CMD} label="Copy command" />
				</div>
			</div>
		</div>

		<div class="mt-6">
			<div class="text-sm font-semibold">Resource schema</div>
			<p class="mt-2 text-sm bc-prose">Each resource has these fields:</p>

			<div class="mt-4 overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-[hsl(var(--bc-border))]">
							<th class="pb-2 pr-4 text-left font-semibold">Field</th>
							<th class="pb-2 pr-4 text-left font-semibold">Required</th>
							<th class="pb-2 text-left font-semibold">Description</th>
						</tr>
					</thead>
					<tbody class="bc-prose">
						<tr class="border-b border-[hsl(var(--bc-border))]">
							<td class="py-2 pr-4"><code class="bc-inlineCode">type</code></td>
							<td class="py-2 pr-4">Yes</td>
							<td class="py-2">
								<code class="bc-inlineCode">"git"</code> or
								<code class="bc-inlineCode">"local"</code>
							</td>
						</tr>
						<tr class="border-b border-[hsl(var(--bc-border))]">
							<td class="py-2 pr-4"><code class="bc-inlineCode">name</code></td>
							<td class="py-2 pr-4">Yes</td>
							<td class="py-2">Short identifier used in CLI commands</td>
						</tr>
						<tr class="border-b border-[hsl(var(--bc-border))]">
							<td class="py-2 pr-4"><code class="bc-inlineCode">url</code></td>
							<td class="py-2 pr-4">Yes</td>
							<td class="py-2">Git repository URL (git only)</td>
						</tr>
						<tr class="border-b border-[hsl(var(--bc-border))]">
							<td class="py-2 pr-4"><code class="bc-inlineCode">branch</code></td>
							<td class="py-2 pr-4">Yes</td>
							<td class="py-2">Branch to clone (git only)</td>
						</tr>
						<tr class="border-b border-[hsl(var(--bc-border))]">
							<td class="py-2 pr-4"><code class="bc-inlineCode">path</code></td>
							<td class="py-2 pr-4">Yes</td>
							<td class="py-2">Local directory path (local only)</td>
						</tr>
						<tr class="border-b border-[hsl(var(--bc-border))]">
							<td class="py-2 pr-4"><code class="bc-inlineCode">searchPath</code></td>
							<td class="py-2 pr-4">No</td>
							<td class="py-2">Subdirectory to search within the repo (git only)</td>
						</tr>
						<tr class="border-b border-[hsl(var(--bc-border))]">
							<td class="py-2 pr-4"><code class="bc-inlineCode">searchPaths</code></td>
							<td class="py-2 pr-4">No</td>
							<td class="py-2">Multiple subdirectories to search within the repo (git only)</td>
						</tr>
						<tr>
							<td class="py-2 pr-4"><code class="bc-inlineCode">specialNotes</code></td>
							<td class="py-2 pr-4">No</td>
							<td class="py-2">Hints for the AI about this resource</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	</section>

	<section id="example" class="scroll-mt-28">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Example config</span>
		</div>

		<p class="mt-2 max-w-2xl text-sm bc-prose">
			A complete <code class="bc-inlineCode">btca.config.jsonc</code> file:
		</p>

		<div class="mt-4 bc-card bc-ring p-5">
			<div class="bc-codeFrame">
				<div class="flex items-start justify-between gap-3 p-4">
					<div class="min-w-0 flex-1 overflow-x-auto">
						{#if shikiStore.highlighter}
							{@html shikiStore.highlighter.codeToHtml(CONFIG_EXAMPLE, {
								theme: shikiTheme,
								lang: 'json',
								rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
							})}
						{:else}
							<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{CONFIG_EXAMPLE}</code
								></pre>
						{/if}
					</div>
					<CopyButton text={CONFIG_EXAMPLE} label="Copy config" />
				</div>
			</div>
		</div>
	</section>

	<section id="agents-md" class="scroll-mt-28">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Teach your agent</span>
		</div>

		<p class="mt-2 max-w-2xl text-sm bc-prose">
			Add this to your project's <code class="bc-inlineCode">AGENTS.md</code> so your AI agent knows when
			to use btca:
		</p>

		<div class="mt-4 bc-card bc-ring p-5">
			<div class="bc-codeFrame">
				<div class="flex items-start justify-between gap-3 p-4">
					<textarea
						class="block w-full min-w-0 flex-1 resize-y bg-transparent text-sm leading-relaxed text-[hsl(var(--bc-fg))] outline-none"
						rows="10"
						readonly
						value={AGENTS_MD_SNIPPET}
					></textarea>
					<CopyButton text={AGENTS_MD_SNIPPET} label="Copy AGENTS.md snippet" />
				</div>
			</div>
		</div>
	</section>
</section>
