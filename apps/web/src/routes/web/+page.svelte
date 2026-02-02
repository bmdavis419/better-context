<script lang="ts">
	import webShowcase from '$lib/assets/web-showcase.png';
</script>

<svelte:head>
	<title>btca | Web</title>
	<meta
		name="description"
		content="The btca web app for researching technologies and saving your threads."
	/>
</svelte:head>

<section class="flex flex-col gap-14">
	<header class="flex flex-col gap-5">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Web App</span>
		</div>

		<h1 class="bc-h1 text-balance text-5xl sm:text-6xl">
			Keep your best answers, and keep moving.
		</h1>
		<p class="bc-prose max-w-2xl text-pretty text-base sm:text-lg">
			The web app makes it easy to research technologies and save your threads.
		</p>

		<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
			<a href="/app" class="bc-chip bc-btnPrimary justify-center">Open the app</a>
			<a href="/pricing" class="bc-chip justify-center">See pricing</a>
		</div>
	</header>

	<section>
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Product tour</span>
		</div>
		<p class="mt-2 max-w-2xl text-sm bc-prose">
			A quick look at the chat experience in the web app.
		</p>

		<div class="mt-4">
			<div class="bc-card bc-ring p-5">
				<div class="text-xs font-semibold uppercase tracking-[0.16em] bc-muted">Chat</div>
				<img
					src={webShowcase}
					alt="btca chat interface"
					class="mt-3 w-full rounded-lg border border-[hsl(var(--bc-border))]"
					loading="lazy"
				/>
			</div>
		</div>
	</section>

	<section class="bc-card bc-ring p-6">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<div class="text-sm font-semibold">Ready to try it?</div>
				<p class="mt-1 text-sm bc-prose">Jump into the app or explore pricing details.</p>
			</div>
			<div class="flex flex-wrap gap-3">
				<a href="/app" class="bc-chip bc-btnPrimary">Open the app</a>
				<a href="/pricing" class="bc-chip">See pricing</a>
			</div>
		</div>
	</section>
</section>
