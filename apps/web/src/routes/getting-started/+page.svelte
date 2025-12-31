<script lang="ts">
	import CopyButton from '$lib/CopyButton.svelte';
	import { getShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { getThemeStore } from '$lib/stores/ThemeStore.svelte';

	const INSTALL_CMD = `bun add -g btca opencode-ai && btca`;

	const ADD_RESOURCE_CMD = `btca config resources add -n runed -t git -u https://github.com/svecosystem/runed -b main`;

	const ASK_CMD = `btca ask -r runed -q "How does useDebounce work?"`;
	const CHAT_CMD = `btca chat -r runed`;

	const AGENTS_MD_SNIPPET = `## btca

When the user says "use btca" for codebase/docs questions.

Run:
- btca ask -r <resource> -q "<question>"

Available resources: svelte, tailwindcss`;

	const QUICK_REF = [
		{ cmd: 'btca ask -r <resource> -q "<question>"', desc: 'Ask a single question' },
		{ cmd: 'btca chat -r <resource>', desc: 'Interactive TUI session' },
		{ cmd: 'btca config resources list', desc: 'List configured resources' },
		{ cmd: 'btca config resources add', desc: 'Add a new resource' },
		{ cmd: 'btca config model -p <provider> -m <model>', desc: 'Set AI model' }
	] as const;

	const shikiStore = getShikiStore();
	const themeStore = getThemeStore();
	const shikiTheme = $derived(themeStore.theme === 'dark' ? 'dark-plus' : 'light-plus');
</script>

<section class="flex flex-col gap-10">
	<div class="flex flex-col gap-4">
		<div class="inline-flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
			<span
				class="inline-flex items-center rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-1 text-xs font-medium text-orange-700 dark:border-orange-500/25 dark:bg-orange-500/10 dark:text-orange-300"
				>Getting started</span
			>
			<span class="hidden sm:inline">Install, add resources, and start asking questions.</span>
		</div>

		<h1
			class="text-balance text-4xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50 sm:text-5xl"
		>
			Getting started with btca
		</h1>

		<p
			class="max-w-2xl text-pretty text-base leading-relaxed text-neutral-700 dark:text-neutral-300 sm:text-lg"
		>
			Install <code class="rounded bg-neutral-900/5 px-1.5 py-1 text-sm dark:bg-white/10">btca</code
			>, add resources, and start asking questions about any codebase.
		</p>
	</div>

	<section id="install" class="scroll-mt-28">
		<h2 class="text-xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
			Install
		</h2>
		<p class="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
			Install globally with Bun, then run
			<code class="rounded bg-neutral-900/5 px-1.5 py-1 text-xs dark:bg-white/10">btca --help</code
			>.
		</p>

		<div
			class="relative mt-4 min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white/70 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/30"
		>
			<div class="flex items-center justify-between gap-3 p-4">
				<div class="min-w-0 flex-1 overflow-x-auto">
					{#if shikiStore.highlighter}
						{@html shikiStore.highlighter.codeToHtml(INSTALL_CMD, {
							theme: shikiTheme,
							lang: 'bash',
							rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
						})}
					{:else}
						<pre
							class="m-0 whitespace-pre text-sm leading-relaxed text-neutral-900 dark:text-neutral-50"><code
								>{INSTALL_CMD}</code
							></pre>
					{/if}
				</div>
				<CopyButton text={INSTALL_CMD} label="Copy install command" />
			</div>
		</div>
	</section>

	<section id="add-resource" class="scroll-mt-28">
		<h2 class="text-xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
			Add your first resource
		</h2>
		<p class="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
			Add a git repository as a resource. Here's an example adding
			<a
				href="https://github.com/svecosystem/runed"
				target="_blank"
				rel="noreferrer"
				class="text-orange-600 hover:underline dark:text-orange-400">runed</a
			>:
		</p>

		<div
			class="relative mt-4 min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white/70 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/30"
		>
			<div class="flex items-center justify-between gap-3 p-4">
				<div class="min-w-0 flex-1 overflow-x-auto">
					{#if shikiStore.highlighter}
						{@html shikiStore.highlighter.codeToHtml(ADD_RESOURCE_CMD, {
							theme: shikiTheme,
							lang: 'bash',
							rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
						})}
					{:else}
						<pre
							class="m-0 whitespace-pre text-sm leading-relaxed text-neutral-900 dark:text-neutral-50"><code
								>{ADD_RESOURCE_CMD}</code
							></pre>
					{/if}
				</div>
				<CopyButton text={ADD_RESOURCE_CMD} label="Copy add resource command" />
			</div>
		</div>
	</section>

	<section id="ask" class="scroll-mt-28">
		<h2 class="text-xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
			Ask a question
		</h2>
		<p class="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
			Use <code class="rounded bg-neutral-900/5 px-1 py-0.5 text-xs dark:bg-white/10">ask</code> for
			a single question, or
			<code class="rounded bg-neutral-900/5 px-1 py-0.5 text-xs dark:bg-white/10">chat</code> for an
			interactive session.
		</p>

		<div class="mt-4 grid gap-4 md:grid-cols-2">
			<div
				class="min-w-0 rounded-2xl border border-orange-500/20 bg-orange-500/10 p-5 shadow-sm dark:border-orange-500/25 dark:bg-orange-500/10"
			>
				<div class="text-sm font-semibold text-neutral-950 dark:text-neutral-50">Ask</div>
				<div class="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
					Answer a single question
				</div>
				<div
					class="relative mt-3 min-w-0 overflow-hidden rounded-xl border border-neutral-200 bg-white/70 dark:border-neutral-800 dark:bg-neutral-950/40"
				>
					<div class="flex items-center justify-between gap-3 p-4">
						<div class="min-w-0 flex-1 overflow-x-auto">
							{#if shikiStore.highlighter}
								{@html shikiStore.highlighter.codeToHtml(ASK_CMD, {
									theme: shikiTheme,
									lang: 'bash',
									rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
								})}
							{:else}
								<pre
									class="m-0 whitespace-pre text-sm leading-relaxed text-neutral-900 dark:text-neutral-50"><code
										>{ASK_CMD}</code
									></pre>
							{/if}
						</div>
						<CopyButton text={ASK_CMD} label="Copy ask command" />
					</div>
				</div>
			</div>

			<div
				class="min-w-0 rounded-2xl border border-orange-500/20 bg-orange-500/10 p-5 shadow-sm dark:border-orange-500/25 dark:bg-orange-500/10"
			>
				<div class="text-sm font-semibold text-neutral-950 dark:text-neutral-50">Chat</div>
				<div class="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
					Open an interactive session
				</div>
				<div
					class="relative mt-3 min-w-0 overflow-hidden rounded-xl border border-neutral-200 bg-white/70 dark:border-neutral-800 dark:bg-neutral-950/40"
				>
					<div class="flex items-center justify-between gap-3 p-4">
						<div class="min-w-0 flex-1 overflow-x-auto">
							{#if shikiStore.highlighter}
								{@html shikiStore.highlighter.codeToHtml(CHAT_CMD, {
									theme: shikiTheme,
									lang: 'bash',
									rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
								})}
							{:else}
								<pre
									class="m-0 whitespace-pre text-sm leading-relaxed text-neutral-900 dark:text-neutral-50"><code
										>{CHAT_CMD}</code
									></pre>
							{/if}
						</div>
						<CopyButton text={CHAT_CMD} label="Copy chat command" />
					</div>
				</div>
			</div>
		</div>
	</section>

	<section id="agents-md" class="scroll-mt-28">
		<h2 class="text-xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
			Add to your project
		</h2>
		<p class="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
			Paste this into your project's <code
				class="rounded bg-neutral-900/5 px-1.5 py-1 text-xs dark:bg-white/10">AGENTS.md</code
			>
			so your agent knows when to use btca.
		</p>

		<div
			class="mt-4 rounded-xl border border-orange-500/20 bg-orange-500/5 px-4 py-3 text-sm text-neutral-700 dark:border-orange-500/25 dark:bg-orange-500/5 dark:text-neutral-300"
		>
			You can add more resources with
			<code class="rounded bg-neutral-900/5 px-1 py-0.5 text-xs dark:bg-white/10"
				>btca config resources add</code
			>
			and update this list to match your project's needs.
		</div>

		<div
			class="relative mt-4 min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white/70 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/30"
		>
			<div class="flex items-center justify-between gap-3 p-4">
				<textarea
					class="block w-full min-w-0 flex-1 resize-y bg-transparent font-mono text-sm leading-relaxed text-neutral-900 outline-none dark:text-neutral-50"
					rows="10"
					readonly
					value={AGENTS_MD_SNIPPET}
				></textarea>
				<CopyButton text={AGENTS_MD_SNIPPET} label="Copy AGENTS.md snippet" />
			</div>
		</div>
	</section>

	<section id="quick-ref" class="scroll-mt-28">
		<h2 class="text-xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50">
			Quick reference
		</h2>
		<p class="mt-2 max-w-2xl text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
			Common commands at a glance.
		</p>

		<div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each QUICK_REF as ref}
				<div
					class="min-w-0 rounded-2xl border border-neutral-200 bg-white/70 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900/30"
				>
					<div class="text-sm font-medium text-neutral-900 dark:text-neutral-50">
						{ref.desc}
					</div>
					<div
						class="relative mt-2 min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white/70 dark:border-neutral-800 dark:bg-neutral-950/40"
					>
						<div class="flex items-center justify-between gap-2 p-3">
							<div class="min-w-0 flex-1 overflow-x-auto">
								{#if shikiStore.highlighter}
									{@html shikiStore.highlighter.codeToHtml(ref.cmd, {
										theme: shikiTheme,
										lang: 'bash',
										rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
									})}
								{:else}
									<pre
										class="m-0 whitespace-pre text-xs leading-relaxed text-neutral-900 dark:text-neutral-50"><code
											>{ref.cmd}</code
										></pre>
								{/if}
							</div>
							<CopyButton text={ref.cmd} label="Copy command" />
						</div>
					</div>
				</div>
			{/each}
		</div>
	</section>
</section>
