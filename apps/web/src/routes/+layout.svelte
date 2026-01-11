<script lang="ts">
	import './layout.css';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';
	import favicon from '$lib/assets/favicon.svg';
	import ogImage from '$lib/assets/og.png';
	import { Bot, Github, Menu, Moon, Sun, X } from '@lucide/svelte';
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
	let mobileNavOpen = $state(false);

	const toggleTheme = () => {
		themeStore.toggle();
	};

	const toggleNav = () => {
		mobileNavOpen = !mobileNavOpen;
	};

	$effect(() => {
		page.url.pathname;
		mobileNavOpen = false;
	});
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
	<div aria-hidden="true" class="pointer-events-none absolute inset-0 -z-10 bc-appBg"></div>

	<div class="bc-skip">
		<a class="bc-skipLink" href="#main">Skip to content</a>
	</div>

	<header class="sticky top-0 z-20 bc-header">
		<div class="bc-container flex items-center justify-between gap-4 py-4">
			<a href="/" class="bc-chip" aria-label="Go home">
				<div class="bc-logoMark">
					<Bot size={18} strokeWidth={2.25} />
				</div>
				<div class="min-w-0 leading-tight">
					<div class="bc-title text-sm">Better Context</div>
					<div class="bc-subtitle text-xs">btca · local-first code answer engine</div>
				</div>
			</a>

			<nav aria-label="Primary" class="hidden items-center gap-1 sm:flex">
				<a class="bc-navLink" href="/getting-started">Getting started</a>
				<a class="bc-navLink" href="/commands">Commands</a>
				<a class="bc-navLink" href="/models">Models</a>
			</nav>

			<div class="flex items-center gap-2">
				<a
					class="bc-chip hidden sm:inline-flex"
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
					class="bc-chip"
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

				<button
					type="button"
					class="bc-chip sm:hidden"
					onclick={toggleNav}
					aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
					title={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
				>
					{#if mobileNavOpen}
						<X size={18} strokeWidth={2.25} />
					{:else}
						<Menu size={18} strokeWidth={2.25} />
					{/if}
				</button>
			</div>
		</div>

		{#if mobileNavOpen}
			<div class="bc-container pb-4 sm:hidden">
				<div class="bc-card bc-ring p-2">
					<nav aria-label="Mobile" class="flex flex-col">
						<a class="bc-navLink" href="/getting-started">Getting started</a>
						<a class="bc-navLink" href="/commands">Commands</a>
						<a class="bc-navLink" href="/models">Models</a>
						<a
							class="bc-navLink"
							href="https://github.com/bmdavis419/better-context"
							target="_blank"
							rel="noreferrer"
						>
							GitHub
						</a>
					</nav>
				</div>
			</div>
		{/if}
	</header>

	<main id="main" class={fullBleed ? 'py-10' : 'bc-container py-12'}>
		{#if fullBleed}
			{@render children()}
		{:else}
			{@render children()}
		{/if}
	</main>

	<footer
		class="mt-10 border-t border-[color:color-mix(in_oklab,hsl(var(--bc-border))_55%,transparent)]"
	>
		<div class="bc-container grid gap-8 py-12 sm:grid-cols-2">
			<div class="flex flex-col gap-2">
				<div class="text-sm font-semibold tracking-tight">
					Built for agents that actually read code.
				</div>
				<div class="text-sm bc-muted">Bun + Effect + SvelteKit. Zero fluff, full context.</div>
			</div>

			<div class="flex flex-wrap items-start gap-2 sm:justify-end">
				<a class="bc-chip" href="/getting-started#install">Install</a>
				<a
					class="bc-chip"
					href="https://github.com/bmdavis419/better-context"
					target="_blank"
					rel="noreferrer"
				>
					GitHub
				</a>
				<a class="bc-chip" href="/commands">Command reference</a>
			</div>
		</div>
	</footer>
</div>
