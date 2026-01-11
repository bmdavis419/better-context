<script lang="ts">
	import CopyButton from '$lib/CopyButton.svelte';
	import { getShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { getThemeStore } from '$lib/stores/ThemeStore.svelte';

	const INSTALL_CMD = `bun add -g btca opencode-ai && btca`;

	const ADD_RESOURCE_CMD = `btca config resources add -n runed -t git -u https://github.com/svecosystem/runed -b main`;

	const ASK_CMD = `btca ask -r runed -q "How does useDebounce work?"`;
	const CHAT_CMD = `btca chat -r runed`;

	const AGENTS_MD_SNIPPET = `## btca

When the user says "use btca" for codebase/docs questions.

Run:
- btca ask -r <resource> -q "<question>"

Available resources: svelte, tailwindcss`;

	const QUICK_REF = [
		{ cmd: 'btca ask -r <resource> -q "<question>"', desc: 'Ask a single question' },
		{ cmd: 'btca chat -r <resource>', desc: 'Interactive TUI session' },
		{ cmd: 'btca config resources list', desc: 'List configured resources' },
		{ cmd: 'btca config resources add', desc: 'Add a new resource' },
		{ cmd: 'btca config model -p <provider> -m <model>', desc: 'Set AI model' }
	] as const;

	const shikiStore = getShikiStore();
	const themeStore = getThemeStore();
	const shikiTheme = $derived(themeStore.theme === 'dark' ? 'dark-plus' : 'light-plus');
</script>

<section class="flex flex-col gap-14">
	<header class="flex flex-col gap-5">
		<div class="bc-kicker bc-reveal" style="--delay: 0ms">
			<span class="bc-kickerDot"></span>
			<span>Getting started</span>
			<span class="hidden sm:inline bc-muted">Install, add resources, ask better questions</span>
		</div>

		<h1 class="bc-h1 text-balance text-5xl sm:text-6xl bc-reveal" style="--delay: 90ms">
			Set up btca in <span class="text-[color:hsl(var(--bc-accent))]">three minutes</span>.
		</h1>

		<p class="bc-prose max-w-2xl text-pretty text-base sm:text-lg bc-reveal" style="--delay: 160ms">
			Install <code class="bc-inlineCode">btca</code>, add your first repo, then ask questions that
			are grounded in the actual source.
		</p>
	</header>

	<section id="install" class="scroll-mt-28">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Install</span>
		</div>
		<p class="mt-2 max-w-2xl text-sm bc-prose">
			Install globally with Bun, then run <code class="bc-inlineCode">btca --help</code>.
		</p>

		<div class="mt-4 bc-card bc-ring p-5">
			<div class="bc-codeFrame">
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
	</section>

	<section id="add-resource" class="scroll-mt-28">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Add your first resource</span>
		</div>
		<p class="mt-2 max-w-2xl text-sm bc-prose">
			Add a git repository as a resource. Here’s an example adding
			<a
				href="https://github.com/svecosystem/runed"
				target="_blank"
				rel="noreferrer"
				class="text-[color:hsl(var(--bc-accent))]">runed</a
			>.
		</p>

		<div class="mt-4 bc-card bc-ring p-5">
			<div class="bc-codeFrame">
				<div class="flex items-center justify-between gap-3 p-4">
					<div class="min-w-0 flex-1 overflow-x-auto">
						{#if shikiStore.highlighter}
							{@html shikiStore.highlighter.codeToHtml(ADD_RESOURCE_CMD, {
								theme: shikiTheme,
								lang: 'bash',
								rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
							})}
						{:else}
							<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{ADD_RESOURCE_CMD}</code
								></pre>
						{/if}
					</div>
					<CopyButton text={ADD_RESOURCE_CMD} label="Copy add resource command" />
				</div>
			</div>
		</div>
	</section>

	<section id="ask" class="scroll-mt-28">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Ask (or chat)</span>
		</div>
		<p class="mt-2 max-w-2xl text-sm bc-prose">
			Use <code class="bc-inlineCode">ask</code> for a single question, or
			<code class="bc-inlineCode">chat</code>
			for a longer interactive session.
		</p>

		<div class="mt-4 grid gap-4 md:grid-cols-2">
			<div class="bc-card bc-ring bc-cardHover p-6">
				<div class="text-sm font-semibold">Ask</div>
				<div class="mt-2 text-sm bc-prose">Answer a single question.</div>
				<div class="mt-3 bc-codeFrame">
					<div class="flex items-center justify-between gap-3 p-4">
						<div class="min-w-0 flex-1 overflow-x-auto">
							{#if shikiStore.highlighter}
								{@html shikiStore.highlighter.codeToHtml(ASK_CMD, {
									theme: shikiTheme,
									lang: 'bash',
									rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
								})}
							{:else}
								<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{ASK_CMD}</code></pre>
							{/if}
						</div>
						<CopyButton text={ASK_CMD} label="Copy ask command" />
					</div>
				</div>
			</div>

			<div class="bc-card bc-ring bc-cardHover p-6">
				<div class="text-sm font-semibold">Chat</div>
				<div class="mt-2 text-sm bc-prose">Open a full session in the TUI.</div>
				<div class="mt-3 bc-codeFrame">
					<div class="flex items-center justify-between gap-3 p-4">
						<div class="min-w-0 flex-1 overflow-x-auto">
							{#if shikiStore.highlighter}
								{@html shikiStore.highlighter.codeToHtml(CHAT_CMD, {
									theme: shikiTheme,
									lang: 'bash',
									rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
								})}
							{:else}
								<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{CHAT_CMD}</code
									></pre>
							{/if}
						</div>
						<CopyButton text={CHAT_CMD} label="Copy chat command" />
					</div>
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
			Paste this into your project’s <code class="bc-inlineCode">AGENTS.md</code> so your agent knows
			when to use btca.
		</p>

		<div
			class="mt-4 border border-[color:hsl(var(--bc-border))] bg-[color:hsl(var(--bc-surface))] p-4 text-sm bc-prose"
		>
			Tip: you can add more resources with <code class="bc-inlineCode"
				>btca config resources add</code
			> and keep the list in sync with your project.
		</div>

		<div class="mt-4 bc-card bc-ring p-5">
			<div class="bc-codeFrame">
				<div class="flex items-start justify-between gap-3 p-4">
					<textarea
						class="block w-full min-w-0 flex-1 resize-y bg-transparent text-sm leading-relaxed text-[color:hsl(var(--bc-fg))] outline-none"
						rows="10"
						readonly
						value={AGENTS_MD_SNIPPET}
					></textarea>
					<CopyButton text={AGENTS_MD_SNIPPET} label="Copy AGENTS.md snippet" />
				</div>
			</div>
		</div>
	</section>

	<section id="quick-ref" class="scroll-mt-28">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Quick reference</span>
		</div>
		<p class="mt-2 max-w-2xl text-sm bc-prose">Common commands at a glance.</p>

		<div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each QUICK_REF as ref}
				<div class="bc-card bc-ring bc-cardHover p-5">
					<div class="text-sm font-semibold">{ref.desc}</div>
					<div class="mt-3 bc-codeFrame">
						<div class="flex items-center justify-between gap-3 p-4">
							<div class="min-w-0 flex-1 overflow-x-auto">
								{#if shikiStore.highlighter}
									{@html shikiStore.highlighter.codeToHtml(ref.cmd, {
										theme: shikiTheme,
										lang: 'bash',
										rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
									})}
								{:else}
									<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{ref.cmd}</code
										></pre>
								{/if}
							</div>
							<CopyButton text={ref.cmd} label="Copy command" />
						</div>
					</div>
				</div>
			{/each}
		</div>
	</section>
</section>
