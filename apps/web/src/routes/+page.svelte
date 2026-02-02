<script lang="ts">
	import cliShowcase from '$lib/assets/cli-showcase.png';
	import mcpShowcase from '$lib/assets/mcp-showcase.png';
	import webShowcase from '$lib/assets/web-showcase.png';
</script>

<svelte:head>
	<title>btca</title>
	<meta
		name="description"
		content="btca helps you ask questions about real codebases with a CLI and web app."
	/>
</svelte:head>

<section class="flex flex-col gap-14">
	<section class="flex flex-col gap-5">
		<h1 class="bc-h1 text-balance text-5xl sm:text-6xl lg:text-7xl bc-reveal" style="--delay: 90ms">
			Better Context for
			<span class="text-[hsl(var(--bc-accent))]">You and Your Agents</span>
		</h1>

		<p class="bc-prose max-w-xl text-pretty text-base sm:text-lg bc-reveal" style="--delay: 160ms">
			Search real repos with the CLI or the web app, and get answers grounded in source code.
		</p>

		<div class="flex flex-col gap-3 sm:flex-row sm:items-center bc-reveal" style="--delay: 230ms">
			<a href="/app" class="bc-chip bc-btnPrimary justify-center">Go to the app</a>
			<a
				href="https://docs.btca.dev/guides/quickstart"
				class="bc-chip justify-center"
				target="_blank"
				rel="noreferrer"
			>
				Use the CLI
			</a>
			<a href="/pricing" class="bc-chip justify-center">See pricing</a>
		</div>
	</section>

	<section class="bc-card bc-ring bc-cardHover overflow-hidden">
		<div class="flex items-center justify-between gap-4 px-5 py-4">
			<div class="bc-badge bc-badgeAccent">
				<span class="bc-kickerDot"></span>
				<span>cli</span>
			</div>
			<div class="text-xs font-semibold tracking-[0.16em] uppercase bc-muted">example</div>
		</div>

		<div class="px-5 pb-5">
			<img
				src={cliShowcase}
				alt="btca CLI showcase"
				class="w-full rounded-lg border border-[hsl(var(--bc-border))]"
				loading="lazy"
			/>
		</div>
	</section>

	<section class="bc-card bc-ring p-5">
		<div class="bc-badge bc-badgeAccent">
			<span class="bc-kickerDot"></span>
			<span>web</span>
		</div>
		<img
			src={webShowcase}
			alt="btca chat interface"
			class="mt-4 w-full rounded-lg border border-[hsl(var(--bc-border))]"
			loading="lazy"
		/>
	</section>

	<section class="bc-card bc-ring p-5">
		<div class="bc-badge bc-badgeAccent">
			<span class="bc-kickerDot"></span>
			<span>mcp</span>
		</div>
		<img
			src={mcpShowcase}
			alt="btca MCP server showcase"
			class="mt-4 w-full rounded-lg border border-[hsl(var(--bc-border))]"
			loading="lazy"
		/>
	</section>

	<section class="bc-card bc-ring p-6">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<div class="text-sm font-semibold">More to explore</div>
				<p class="mt-1 text-sm bc-prose">Pricing, resources, setup, and configuration docs.</p>
			</div>
			<div class="flex flex-wrap gap-3">
				<a href="/pricing" class="bc-chip">Pricing</a>
				<a href="/resources" class="bc-chip">Resources</a>
				<a href="https://docs.btca.dev" class="bc-chip" target="_blank" rel="noreferrer"> Docs </a>
				<a href="/web" class="bc-chip">Web app</a>
				<a
					href="https://docs.btca.dev/guides/configuration"
					class="bc-chip"
					target="_blank"
					rel="noreferrer"
				>
					Configuration
				</a>
			</div>
		</div>
	</section>
</section>
