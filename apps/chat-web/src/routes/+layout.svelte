<script lang="ts">
	import './layout.css';
	import { Bot, Moon, Sun, Github } from '@lucide/svelte';
	import { setThemeStore } from '$lib/stores/theme.svelte';

	let { children } = $props();

	const themeStore = setThemeStore();

	const toggleTheme = () => {
		themeStore.toggle();
	};
</script>

<svelte:head>
	<title>btca Chat</title>
	<meta name="description" content="Web-based chat interface for btca" />
</svelte:head>

<div class="relative flex min-h-dvh flex-col overflow-hidden">
	<div aria-hidden="true" class="bc-appBg pointer-events-none absolute inset-0 -z-10"></div>

	<header class="bc-header sticky top-0 z-20">
		<div class="bc-container flex items-center justify-between gap-4 py-4">
			<a href="/" class="bc-chip" aria-label="Go home">
				<div class="bc-logoMark">
					<Bot size={18} strokeWidth={2.25} />
				</div>
				<div class="min-w-0 leading-tight">
					<div class="bc-title text-sm">btca Chat</div>
					<div class="bc-subtitle text-xs">Web-based btca interface</div>
				</div>
			</a>

			<div class="flex items-center gap-2">
				<a
					class="bc-chip"
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
			</div>
		</div>
	</header>

	<main id="main" class="flex flex-1 flex-col">
		{@render children()}
	</main>
</div>
