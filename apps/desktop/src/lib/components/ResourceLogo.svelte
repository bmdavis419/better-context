<script lang="ts">
	import ClerkSvg from '$lib/svgs/ClerkSvg.svelte';
	import ConvexSvg from '$lib/svgs/ConvexSvg.svelte';
	import DaytonaSvg from '$lib/svgs/DaytonaSvg.svelte';
	import HonoSvg from '$lib/svgs/HonoSvg.svelte';
	import OpencodeSvg from '$lib/svgs/OpencodeSvg.svelte';
	import SolidSvg from '$lib/svgs/SolidSvg.svelte';
	import SvelteSvg from '$lib/svgs/SvelteSvg.svelte';
	import TailwindSvg from '$lib/svgs/TailwindSvg.svelte';
	import TurboSvg from '$lib/svgs/TurboSvg.svelte';
	import ViteSvg from '$lib/svgs/ViteSvg.svelte';
	import ZodSvg from '$lib/svgs/ZodSvg.svelte';

	let {
		size = 36,
		className = '',
		logoKey
	} = $props<{
		size?: number;
		className?: string;
		logoKey?: string;
	}>();

	const Logo = $derived.by(() => {
		switch (logoKey) {
			case 'svelte':
				return SvelteSvg;
			case 'daytona':
				return DaytonaSvg;
			case 'convex':
				return ConvexSvg;
			case 'clerk':
				return ClerkSvg;
			case 'hono':
				return HonoSvg;
			case 'opencode':
				return OpencodeSvg;
			case 'zod':
				return ZodSvg;
			case 'solid':
				return SolidSvg;
			case 'tailwind':
				return TailwindSvg;
			case 'turbo':
				return TurboSvg;
			case 'vite':
				return ViteSvg;
			default:
				return null;
		}
	});
</script>

<div class={`resource-logo ${className}`} style={`width: ${size}px; height: ${size}px;`}>
	{#if Logo}
		<Logo />
	{:else}
		<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
			<rect x="6" y="6" width="52" height="52" rx="14" fill="currentColor" opacity="0.16" />
			<rect x="14" y="14" width="36" height="36" rx="10" stroke="currentColor" stroke-width="3" />
			<path
				d="M24 34c0-5.523 4.477-10 10-10h6"
				stroke="currentColor"
				stroke-width="3"
				stroke-linecap="round"
			/>
			<circle cx="24" cy="34" r="4" fill="currentColor" />
			<circle cx="40" cy="24" r="4" fill="currentColor" />
		</svg>
	{/if}
</div>

<style>
	.resource-logo {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.resource-logo :global(svg) {
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
