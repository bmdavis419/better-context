<script lang="ts">
	import CopyButton from '$lib/CopyButton.svelte';
	import { getShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { getThemeStore } from '$lib/stores/ThemeStore.svelte';

	const INSTALL_CMD = `bun add -g btca opencode-ai && btca`;

	const DEMO = `btca ask --resource svelte --question "How does the $state rune work?"

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
				clones repos locally, searches the actual source, then answers with receipts.
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

	<section id="install" class="scroll-mt-28">
		<div class="bc-kicker bc-reveal" style="--delay: 120ms">
			<span class="bc-kickerDot"></span>
			<span>Install</span>
		</div>

		<h2 class="mt-3 text-2xl font-semibold tracking-tight bc-reveal" style="--delay: 170ms">
			One line.
		</h2>
		<p class="mt-2 max-w-2xl text-sm bc-prose bc-reveal" style="--delay: 220ms">
			Install globally with Bun, then run <code class="bc-inlineCode">btca</code> to launch the TUI.
		</p>

		<div class="mt-5 bc-card bc-ring p-5">
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
</section>
