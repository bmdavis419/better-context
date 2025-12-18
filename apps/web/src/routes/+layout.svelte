<script lang="ts">
	import './layout.css';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';
	import favicon from '$lib/assets/favicon.svg';
	import ogImage from '$lib/assets/og.png';
	import { Bot, Github, Moon, Sun } from '@lucide/svelte';
	import { page } from '$app/state';
	import { setShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { setThemeStore } from '$lib/stores/ThemeStore.svelte';
	import { dev } from '$app/environment';

	let { children } = $props();

	injectAnalytics({ mode: dev ? 'development' : 'production' });

	const fullBleed = $derived(page.url.pathname === '/og');
	const ogImageUrl = $derived(new URL(ogImage, page.url).href);

	setShikiStore();
	const themeStore = setThemeStore();

	const toggleTheme = () => {
		themeStore.toggle();
	};
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Better Context</title>
	<meta name="description" content="btca: CLI for asking questions about codebases." />

	<meta property="og:type" content="website" />
	<meta property="og:title" content="The Better Context App" />
	<meta property="og:description" content="btca: CLI for asking questions about codebases." />
	<meta property="og:url" content="https://btca.dev" />
	<meta property="og:site_name" content="The Better Context App" />
	<meta property="og:image" content={ogImageUrl} />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="The Better Context App" />
	<meta name="twitter:description" content="btca: CLI for asking questions about codebases." />
	<meta name="twitter:image" content={ogImageUrl} />
</svelte:head>

<div class="relative min-h-dvh overflow-hidden">
	<div
		aria-hidden="true"
		class="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_40rem_at_20%_-10%,rgba(249,115,22,0.20),transparent_60%),radial-gradient(50rem_30rem_at_90%_0%,rgba(249,115,22,0.12),transparent_55%),radial-gradient(50rem_30rem_at_70%_110%,rgba(249,115,22,0.12),transparent_55%)] dark:bg-[radial-gradient(60rem_40rem_at_20%_-10%,rgba(249,115,22,0.14),transparent_60%),radial-gradient(50rem_30rem_at_90%_0%,rgba(249,115,22,0.10),transparent_55%),radial-gradient(50rem_30rem_at_70%_110%,rgba(249,115,22,0.10),transparent_55%)]"
	></div>

	<header
		class="sticky top-0 z-20 border-b border-neutral-200/70 bg-neutral-50/80 backdrop-blur dark:border-neutral-800/70 dark:bg-neutral-950/60"
	>
		<div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
			<a href="/" class="no-underline">
				<div class="flex items-center gap-2">
					<div
						class="grid size-9 place-items-center rounded-xl bg-linear-to-br from-orange-500 to-orange-700 text-white shadow-sm shadow-orange-500/20"
					>
						<Bot size={18} strokeWidth={2.25} />
					</div>
					<div class="leading-tight">
						<div class="text-sm font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
							The Better Context App
						</div>
						<div class="text-xs text-neutral-600 dark:text-neutral-400">CLI: btca</div>
					</div>
				</div>
			</a>

			<div class="flex items-center gap-3">
				<a
					class="hidden text-sm font-medium text-neutral-900 no-underline hover:underline dark:text-neutral-50 sm:inline-flex"
					href="/getting-started"
				>
					Getting started
				</a>
				<a
					class="hidden text-sm font-medium text-neutral-900 no-underline hover:underline dark:text-neutral-50 sm:inline-flex"
					href="/commands"
				>
					Commands
				</a>
				<a
					class="hidden text-sm font-medium text-neutral-900 no-underline hover:underline dark:text-neutral-50 sm:inline-flex"
					href="/models"
				>
					Models
				</a>
				<a
					class="hidden rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-900 no-underline shadow-sm hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-50 dark:hover:bg-neutral-900 sm:inline-flex"
					href="https://github.com/bmdavis419/better-context"
					target="_blank"
					rel="noreferrer"
					aria-label="GitHub"
					title="GitHub"
				>
					<Github size={18} strokeWidth={2.25} />
				</a>

				<button
					type="button"
					class="inline-flex items-center justify-center rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-900 shadow-sm hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-50 dark:hover:bg-neutral-900"
					onclick={toggleTheme}
					aria-label="Toggle theme"
					title={themeStore.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
				>
					{#if themeStore.theme === 'dark'}
						<Sun size={18} strokeWidth={2.25} />
					{:else}
						<Moon size={18} strokeWidth={2.25} />
					{/if}
				</button>
			</div>
		</div>
	</header>

	<main class="px-6 py-12">
		{#if fullBleed}
			{@render children()}
		{:else}
			<div class="mx-auto w-full max-w-5xl">
				{@render children()}
			</div>
		{/if}
	</main>

	<footer class="border-t border-neutral-200/70 py-10 dark:border-neutral-800/70">
		<div
			class="mx-auto flex max-w-5xl flex-col gap-3 px-6 text-sm text-neutral-600 dark:text-neutral-400 sm:flex-row sm:items-center sm:justify-between"
		>
			<div>Built with Bun + Effect + SvelteKit</div>
			<div class="flex gap-4">
				<a href="https://github.com/bmdavis419/better-context" target="_blank" rel="noreferrer"
					>GitHub</a
				>
				<a href="/getting-started#install">Install</a>
			</div>
		</div>
	</footer>
</div>
