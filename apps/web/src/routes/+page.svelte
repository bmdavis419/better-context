<script lang="ts">
	import CopyButton from '$lib/CopyButton.svelte';
	import { getShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { getThemeStore } from '$lib/stores/ThemeStore.svelte';

	const INSTALL_CMD = `bun add -g btca opencode-ai && btca`;
	const CURSOR_CMD = `mkdir -p .cursor/rules && curl -fsSL "https://btca.dev/rule" -o .cursor/rules/better_context.mdc && echo "Rule file created."`;

	const ASK_CMD = `btca ask -r svelte -q "How does the $state rune work?"`;
	const CHAT_CMD = `btca chat -r svelte`;

	const DEMO = `btca ask -r svelte -q "How does the $state rune work?"

# clones & indexes the repo locally
# searches real files (not docs)
# answers with citations + snippets`;

	const shikiStore = getShikiStore();
	const themeStore = getThemeStore();
	const shikiTheme = $derived(themeStore.theme === 'dark' ? 'dark-plus' : 'light-plus');
</script>

<section class="flex flex-col gap-14">
	<section class="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
		<div class="flex flex-col gap-5">
			<div class="bc-kicker bc-reveal" style="--delay: 0ms">
				<span class="bc-kickerDot"></span>
				<span>Agent-grade docs search</span>
				<span class="hidden sm:inline bc-muted">Local-first · Source-backed · Fast</span>
			</div>

			<h1
				class="bc-h1 text-balance text-5xl sm:text-6xl lg:text-7xl bc-reveal"
				style="--delay: 90ms"
			>
				Ask the codebase,
				<span class="text-[color:hsl(var(--bc-accent))]">not the internet</span>.
			</h1>

			<p
				class="bc-prose max-w-xl text-pretty text-base sm:text-lg bc-reveal"
				style="--delay: 160ms"
			>
				<code class="bc-inlineCode">btca</code>
				clones repos locally, searches the actual source, then answers with receipts. It’s what you wish
				every AI “docs assistant” was.
			</p>

			<div class="flex flex-col gap-3 sm:flex-row sm:items-center bc-reveal" style="--delay: 230ms">
				<a href="/getting-started" class="bc-chip bc-btnPrimary justify-center">Get started</a>
				<a
					href="https://github.com/bmdavis419/better-context"
					target="_blank"
					rel="noreferrer"
					class="bc-chip justify-center"
				>
					View on GitHub
				</a>
			</div>
		</div>

		<div class="bc-card bc-ring bc-cardHover overflow-hidden bc-reveal" style="--delay: 140ms">
			<div class="flex items-center justify-between gap-4 px-5 py-4">
				<div class="bc-badge bc-badgeAccent">
					<span class="bc-kickerDot"></span>
					<span>In the terminal</span>
				</div>
				<div class="text-xs font-semibold tracking-[0.16em] uppercase bc-muted">demo</div>
			</div>

			<div class="px-5 pb-5">
				<div class="bc-codeFrame">
					<div
						class="flex items-center justify-between gap-3 border-b border-[color:color-mix(in_oklab,hsl(var(--bc-border))_60%,transparent)] px-4 py-3"
					>
						<div class="flex items-center gap-2">
							<span class="size-2 bg-[color:hsl(var(--bc-fg))]"></span>
							<span class="size-2 bg-[color:hsl(var(--bc-fg))]"></span>
							<span class="size-2 bg-[color:hsl(var(--bc-fg))]"></span>
						</div>
						<div class="text-xs bc-muted">btca</div>
					</div>

					<div class="p-4">
						{#if shikiStore.highlighter}
							{@html shikiStore.highlighter.codeToHtml(DEMO, {
								theme: shikiTheme,
								lang: 'bash',
								rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
							})}
						{:else}
							<pre class="m-0 whitespace-pre-wrap text-sm leading-relaxed"><code>{DEMO}</code></pre>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</section>

	<section class="grid gap-4 lg:grid-cols-3">
		<div class="bc-card bc-ring bc-cardHover p-6 bc-reveal" style="--delay: 260ms">
			<div class="text-sm font-semibold">1. Index the real source</div>
			<p class="mt-2 text-sm bc-prose">
				Add a repo (git or local). btca clones, stores, and keeps it ready.
			</p>
		</div>

		<div class="bc-card bc-ring bc-cardHover p-6 bc-reveal" style="--delay: 320ms">
			<div class="text-sm font-semibold">2. Ask with intent</div>
			<p class="mt-2 text-sm bc-prose">
				It searches the codebase, pulls the relevant sections, then answers like a senior teammate.
			</p>
		</div>

		<div class="bc-card bc-ring bc-cardHover p-6 bc-reveal" style="--delay: 380ms">
			<div class="text-sm font-semibold">3. Get receipts</div>
			<p class="mt-2 text-sm bc-prose">
				Not vibes. The answer is grounded in the files it found — with clear snippets.
			</p>
		</div>
	</section>

	<section id="install" class="scroll-mt-28">
		<div class="bc-kicker bc-reveal" style="--delay: 120ms">
			<span class="bc-kickerDot"></span>
			<span>Install</span>
		</div>

		<h2 class="mt-3 text-2xl font-semibold tracking-tight bc-reveal" style="--delay: 170ms">
			One line.
		</h2>
		<p class="mt-2 max-w-2xl text-sm bc-prose bc-reveal" style="--delay: 220ms">
			Install globally with Bun, then run <code class="bc-inlineCode">btca --help</code>.
		</p>

		<div class="mt-5 grid gap-4 md:grid-cols-2">
			<div class="bc-card bc-ring p-5">
				<div class="text-sm font-semibold">CLI install</div>
				<div class="mt-3 bc-codeFrame">
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
				<div class="text-sm font-semibold">Cursor rule setup</div>
				<p class="mt-2 text-sm bc-prose">
					Run this from your project root. It installs a rule file so your agent naturally reaches
					for btca.
				</p>
				<div class="mt-3 bc-codeFrame">
					<div class="flex items-center justify-between gap-3 p-4">
						<div class="min-w-0 flex-1 overflow-x-auto">
							{#if shikiStore.highlighter}
								{@html shikiStore.highlighter.codeToHtml(CURSOR_CMD, {
									theme: shikiTheme,
									lang: 'bash',
									rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
								})}
							{:else}
								<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{CURSOR_CMD}</code
									></pre>
							{/if}
						</div>
						<CopyButton text={CURSOR_CMD} label="Copy Cursor rule command" />
					</div>
				</div>
			</div>
		</div>
	</section>

	<section id="commands" class="scroll-mt-28">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Quick commands</span>
		</div>
		<p class="mt-2 max-w-2xl text-sm bc-prose">
			Two ways to use it: <code class="bc-inlineCode">ask</code> for a single answer, and
			<code class="bc-inlineCode">chat</code> for an interactive session.
		</p>

		<div class="mt-4 grid gap-4 md:grid-cols-2">
			<div class="bc-card bc-ring bc-cardHover p-6">
				<div class="text-sm font-semibold">Ask</div>
				<p class="mt-2 text-sm bc-prose">One question in. A grounded answer out.</p>
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
				<p class="mt-2 text-sm bc-prose">Stay in flow. Iterate in a TUI.</p>
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

	<section id="config" class="scroll-mt-28">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Config</span>
		</div>
		<p class="mt-2 max-w-2xl text-sm bc-prose">
			On first run, <code class="bc-inlineCode">btca</code> creates a default config at
			<code class="bc-inlineCode">~/.config/btca/btca.json</code> — that’s where your resources + model/provider
			live.
		</p>
	</section>
</section>
