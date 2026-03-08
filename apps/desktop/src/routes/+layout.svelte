<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import ogImage from '$lib/assets/og.png';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { disposeShikiStoreHighlighter, setShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { setThemeStore } from '$lib/stores/theme.svelte';
	import { initAnalytics } from '$lib/stores/analytics.svelte';
	import { disposeChatHighlighter } from '../lib/shiki/chatHighlighter.ts';

	let { children } = $props();

	const teardownShiki = () => {
		disposeShikiStoreHighlighter();
		disposeChatHighlighter();
	};

	onMount(() => {
		initAnalytics();
		window.addEventListener('pagehide', teardownShiki);
		window.addEventListener('beforeunload', teardownShiki);
		return () => {
			window.removeEventListener('pagehide', teardownShiki);
			window.removeEventListener('beforeunload', teardownShiki);
			teardownShiki();
		};
	});

	const ogImageUrl = $derived(browser ? new URL(ogImage, page.url).href : '');

	setShikiStore();
	setThemeStore();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>btca Desktop</title>
	<meta name="description" content="Desktop app for grounded codebase answers with btca." />

	<meta property="og:type" content="website" />
	<meta property="og:title" content="btca Desktop" />
	<meta property="og:description" content="Desktop app for grounded codebase answers with btca." />
	<meta property="og:image" content={ogImageUrl} />
</svelte:head>

{@render children()}
