<script lang="ts">
	import webShowcase from '$lib/assets/web-showcase.png';
</script>

<svelte:head>
	<title>btca | Web</title>
	<meta
		name="description"
		content="Use the btca web app to save grounded codebase research and revisit it later."
	/>
</svelte:head>

<section class="flex flex-col gap-14">
	<header class="flex flex-col gap-5">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Web App</span>
		</div>

		<h1 class="bc-h1 text-balance text-5xl sm:text-6xl">
			Save grounded codebase research and come back to it later.
		</h1>
		<p class="bc-prose max-w-2xl text-pretty text-base sm:text-lg">
			Search repos in the cloud, save useful threads, and organize work by project - so your
			codebase research stays reusable.
		</p>

		<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
			<a href="/app" class="bc-chip bc-btnPrimary justify-center">Try the web app</a>
			<a href="/pricing" class="bc-chip justify-center">View pricing</a>
		</div>
	</header>

	<section>
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Product tour</span>
		</div>
		<p class="mt-2 max-w-2xl text-sm bc-prose">
			The web app is built for longer-running research, saved threads, and cloud-indexed repos.
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

		<ul class="mt-4 flex flex-col gap-2 text-sm bc-prose">
			<li class="flex items-start gap-2">
				<span class="bc-kickerDot mt-1.5 shrink-0"></span>
				<span><strong>Ask questions against selected repos, not random web context</strong></span>
			</li>
			<li class="flex items-start gap-2">
				<span class="bc-kickerDot mt-1.5 shrink-0"></span>
				<span><strong>Save and resume threads without losing the chain of reasoning</strong></span>
			</li>
			<li class="flex items-start gap-2">
				<span class="bc-kickerDot mt-1.5 shrink-0"></span>
				<span><strong>Add git repos to searchable projects</strong></span>
			</li>
			<li class="flex items-start gap-2">
				<span class="bc-kickerDot mt-1.5 shrink-0"></span>
				<span><strong>Choose between low, balanced, and high-end models per project</strong></span>
			</li>
			<li class="flex items-start gap-2">
				<span class="bc-kickerDot mt-1.5 shrink-0"></span>
				<span><strong>Share one monthly AI usage budget across all web models</strong></span>
			</li>
			<li class="flex items-start gap-2">
				<span class="bc-kickerDot mt-1.5 shrink-0"></span>
				<span><strong>Separate work by project, repo set, and thread history</strong></span>
			</li>
		</ul>
	</section>

	<section class="bc-card bc-ring p-6">
		<div class="max-w-3xl">
			<div class="text-sm font-semibold">Why use btca?</div>
			<p class="mt-2 text-sm bc-prose">
				Generic AI answers are often based on priors, stale docs, or incomplete context. btca
				narrows the model to the repos and resources you choose, so answers are grounded in the
				codebase you actually care about.
			</p>
		</div>
	</section>

	<section class="bc-card bc-ring p-6">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<div class="text-sm font-semibold">Ready to try it?</div>
				<p class="mt-1 text-sm bc-prose">
					Start with a repo, ask a question, and keep the useful threads. Upgrade when you need more
					usage and cloud workflow.
				</p>
			</div>
			<div class="flex flex-wrap gap-3">
				<a href="/app" class="bc-chip bc-btnPrimary">Try the web app</a>
				<a href="/pricing" class="bc-chip">View pricing</a>
			</div>
		</div>
	</section>
</section>
