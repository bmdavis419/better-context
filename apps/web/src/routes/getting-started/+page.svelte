<script lang="ts">
	import CopyButton from '$lib/CopyButton.svelte';
	import { getShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { getThemeStore } from '$lib/stores/theme.svelte';
	import { BLESSED_MODELS } from '@btca/shared';
	import { Check, ChevronRight, Download } from '@lucide/svelte';

	// Import docs content as raw text
	import SETUP_PROMPT_RAW from '$lib/assets/docs/SETUP_PROMPT.md?raw';
	import EXAMPLE_AGENTS_SECTION from '$lib/assets/docs/example-AGENTS-section.md?raw';
	import EXAMPLE_CONFIG from '$lib/assets/docs/example-btca.config.jsonc?raw';

	const shikiStore = getShikiStore();
	const themeStore = getThemeStore();
	const shikiTheme = $derived(themeStore.theme === 'dark' ? 'dark-plus' : 'light-plus');

	// Step 1: Install
	const INSTALL_CMD = `bun add -g btca opencode-ai`;

	// Step 2: Provider setup (show recommended model)
	const recommendedModel =
		BLESSED_MODELS.find((m) => m.model === 'claude-haiku-4-5') ?? BLESSED_MODELS[0];
	const MODEL_CMD = `btca config model --provider ${recommendedModel.provider} --model ${recommendedModel.model}`;

	// Step 3: Agent setup prompt - extract detailed instructions from the markdown file
	// (everything after "## Detailed Instructions")
	const SETUP_PROMPT =
		SETUP_PROMPT_RAW.split('## Detailed Instructions')[1]?.split('---')[1]?.trim() ?? '';

	// Track completed steps
	let completedSteps = $state<Set<number>>(new Set());

	const toggleStep = (step: number) => {
		if (completedSteps.has(step)) {
			completedSteps.delete(step);
		} else {
			completedSteps.add(step);
		}
		completedSteps = new Set(completedSteps);
	};
</script>

<section class="flex flex-col gap-14">
	<header class="flex flex-col gap-5">
		<div class="bc-kicker bc-reveal" style="--delay: 0ms">
			<span class="bc-kickerDot"></span>
			<span>Getting Started</span>
		</div>

		<h1 class="bc-h1 text-balance text-5xl sm:text-6xl bc-reveal" style="--delay: 90ms">
			Set up <span class="text-[color:hsl(var(--bc-accent))]">btca</span> in your project
		</h1>

		<p class="bc-prose max-w-2xl text-pretty text-base sm:text-lg bc-reveal" style="--delay: 160ms">
			Three steps to give your AI agent access to up-to-date documentation and source code.
		</p>
	</header>

	<!-- Step 1: Install -->
	<section id="install" class="scroll-mt-28">
		<button
			type="button"
			class="flex w-full items-center gap-4 text-left"
			onclick={() => toggleStep(1)}
		>
			<div
				class="flex size-10 shrink-0 items-center justify-center border transition-colors"
				class:bg-[hsl(var(--bc-accent))]={completedSteps.has(1)}
				class:border-[hsl(var(--bc-accent))]={completedSteps.has(1)}
				class:bg-[hsl(var(--bc-surface))]={!completedSteps.has(1)}
				class:border-[hsl(var(--bc-border))]={!completedSteps.has(1)}
			>
				{#if completedSteps.has(1)}
					<Check size={20} strokeWidth={2.5} class="text-white" />
				{:else}
					<span class="text-lg font-bold">1</span>
				{/if}
			</div>
			<div class="bc-kicker">
				<span>Install btca & OpenCode</span>
			</div>
		</button>

		<div class="mt-4 ml-14">
			<p class="max-w-2xl text-sm bc-prose">
				Install both <code class="bc-inlineCode">btca</code> and
				<code class="bc-inlineCode">opencode-ai</code> globally. btca uses OpenCode's SDK for AI completions.
			</p>

			<div class="mt-4 bc-card bc-ring p-5">
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

			<p class="mt-3 text-xs bc-prose">
				Requires <a href="https://bun.sh" target="_blank" rel="noreferrer">Bun</a> 1.1.0+
			</p>
		</div>
	</section>

	<!-- Step 2: Configure Provider -->
	<section id="provider" class="scroll-mt-28">
		<button
			type="button"
			class="flex w-full items-center gap-4 text-left"
			onclick={() => toggleStep(2)}
		>
			<div
				class="flex size-10 shrink-0 items-center justify-center border transition-colors"
				class:bg-[hsl(var(--bc-accent))]={completedSteps.has(2)}
				class:border-[hsl(var(--bc-accent))]={completedSteps.has(2)}
				class:bg-[hsl(var(--bc-surface))]={!completedSteps.has(2)}
				class:border-[hsl(var(--bc-border))]={!completedSteps.has(2)}
			>
				{#if completedSteps.has(2)}
					<Check size={20} strokeWidth={2.5} class="text-white" />
				{:else}
					<span class="text-lg font-bold">2</span>
				{/if}
			</div>
			<div class="bc-kicker">
				<span>Configure a model provider</span>
			</div>
		</button>

		<div class="mt-4 ml-14">
			<p class="max-w-2xl text-sm bc-prose">
				btca uses the OpenCode SDK for AI completions. The easiest way to get started is with
				<a
					href={recommendedModel.providerSetupUrl}
					target="_blank"
					rel="noreferrer"
					class="text-[color:hsl(var(--bc-accent))]"
				>
					OpenCode Zen
				</a>, which provides access to multiple models with a single API key.
			</p>

			<div class="mt-4 bc-card bc-ring bc-cardHover p-5">
				<div class="flex flex-wrap items-center gap-2">
					<code class="bc-tag">{recommendedModel.model}</code>
					<span class="bc-badge">{recommendedModel.provider}</span>
					<span class="bc-badge bc-badgeAccent">Recommended</span>
				</div>

				<p class="mt-2 text-sm bc-prose">{recommendedModel.description}</p>

				<div class="mt-3 bc-codeFrame">
					<div class="flex items-center justify-between gap-3 p-4">
						<div class="min-w-0 flex-1 overflow-x-auto">
							{#if shikiStore.highlighter}
								{@html shikiStore.highlighter.codeToHtml(MODEL_CMD, {
									theme: shikiTheme,
									lang: 'bash',
									rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
								})}
							{:else}
								<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{MODEL_CMD}</code
									></pre>
							{/if}
						</div>
						<CopyButton text={MODEL_CMD} label="Copy command" />
					</div>
				</div>

				<a
					href={recommendedModel.providerSetupUrl}
					target="_blank"
					rel="noreferrer"
					class="mt-3 inline-flex items-center gap-1 text-sm text-[color:hsl(var(--bc-accent))]"
				>
					<span>Get your OpenCode Zen API key</span>
					<ChevronRight size={14} />
				</a>
			</div>

			<p class="mt-4 text-sm bc-prose">
				See <a href="/config#models" class="text-[color:hsl(var(--bc-accent))]">all models</a> for Anthropic,
				OpenAI, Google, OpenRouter, and OpenCode options.
			</p>
		</div>
	</section>

	<!-- Step 3: Add to Project -->
	<section id="project-setup" class="scroll-mt-28">
		<button
			type="button"
			class="flex w-full items-center gap-4 text-left"
			onclick={() => toggleStep(3)}
		>
			<div
				class="flex size-10 shrink-0 items-center justify-center border transition-colors"
				class:bg-[hsl(var(--bc-accent))]={completedSteps.has(3)}
				class:border-[hsl(var(--bc-accent))]={completedSteps.has(3)}
				class:bg-[hsl(var(--bc-surface))]={!completedSteps.has(3)}
				class:border-[hsl(var(--bc-border))]={!completedSteps.has(3)}
			>
				{#if completedSteps.has(3)}
					<Check size={20} strokeWidth={2.5} class="text-white" />
				{:else}
					<span class="text-lg font-bold">3</span>
				{/if}
			</div>
			<div class="bc-kicker">
				<span>Add btca to your project</span>
			</div>
		</button>

		<div class="mt-4 ml-14">
			<p class="max-w-2xl text-sm bc-prose">
				Copy this prompt and paste it into your AI coding agent (like
				<a href="https://opencode.ai" target="_blank" rel="noreferrer">OpenCode</a> or similar). The agent
				will scan your dependencies, suggest resources, and create a project-specific config.
			</p>

			<!-- Setup Prompt -->
			<div class="mt-4 bc-card bc-ring p-5">
				<div class="flex items-center justify-between gap-3 mb-3">
					<div class="text-sm font-semibold">Setup Prompt</div>
					<div class="flex gap-2">
						<a
							href="/docs/SETUP_PROMPT.md"
							download="SETUP_PROMPT.md"
							class="bc-iconBtn"
							title="Download as file"
						>
							<Download size={16} />
						</a>
						<CopyButton text={SETUP_PROMPT} label="Copy prompt" />
					</div>
				</div>

				<div class="bc-codeFrame max-h-96 overflow-y-auto">
					<div class="p-4">
						<pre
							class="m-0 whitespace-pre-wrap text-sm leading-relaxed text-[color:hsl(var(--bc-fg))]">{SETUP_PROMPT}</pre>
					</div>
				</div>
			</div>

			<div class="mt-6">
				<div class="text-sm font-semibold">What the agent will do:</div>
				<ul class="mt-3 space-y-2 text-sm bc-prose">
					<li class="flex items-start gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 bg-[hsl(var(--bc-accent))]"></span>
						<span
							>Scan your <code class="bc-inlineCode">package.json</code> for frameworks and libraries</span
						>
					</li>
					<li class="flex items-start gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 bg-[hsl(var(--bc-accent))]"></span>
						<span>Show you the full list of suggested resources to confirm or modify</span>
					</li>
					<li class="flex items-start gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 bg-[hsl(var(--bc-accent))]"></span>
						<span
							>Prepare the complete <code class="bc-inlineCode">btca.config.jsonc</code> and show it for
							your approval</span
						>
					</li>
					<li class="flex items-start gap-2">
						<span class="mt-1.5 size-1.5 shrink-0 bg-[hsl(var(--bc-accent))]"></span>
						<span
							>Create the config file and update <code class="bc-inlineCode">AGENTS.md</code> with usage
							instructions</span
						>
					</li>
				</ul>
			</div>
		</div>
	</section>

	<!-- Example Files Section -->
	<section id="examples" class="scroll-mt-28">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Reference Files</span>
		</div>

		<p class="mt-2 max-w-2xl text-sm bc-prose">
			Here's what the agent will create. You can also use these as templates for manual setup.
		</p>

		<div class="mt-4 grid gap-4 lg:grid-cols-2">
			<!-- Example Config -->
			<div class="bc-card bc-ring p-5">
				<div class="flex items-center justify-between gap-3 mb-3">
					<div class="flex items-center gap-2">
						<code class="bc-inlineCode text-xs">btca.config.jsonc</code>
					</div>
					<div class="flex gap-2">
						<a
							href="/docs/example-btca.config.jsonc"
							download="btca.config.jsonc"
							class="bc-iconBtn"
							title="Download"
						>
							<Download size={16} />
						</a>
						<CopyButton text={EXAMPLE_CONFIG} label="Copy config" />
					</div>
				</div>
				<div class="bc-codeFrame max-h-64 overflow-y-auto">
					<div class="p-4">
						{#if shikiStore.highlighter}
							{@html shikiStore.highlighter.codeToHtml(EXAMPLE_CONFIG, {
								theme: shikiTheme,
								lang: 'json',
								rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
							})}
						{:else}
							<pre class="m-0 whitespace-pre text-sm leading-relaxed"><code>{EXAMPLE_CONFIG}</code
								></pre>
						{/if}
					</div>
				</div>
			</div>

			<!-- Example AGENTS.md Section -->
			<div class="bc-card bc-ring p-5">
				<div class="flex items-center justify-between gap-3 mb-3">
					<div class="flex items-center gap-2">
						<code class="bc-inlineCode text-xs">AGENTS.md section</code>
					</div>
					<div class="flex gap-2">
						<a
							href="/docs/example-AGENTS-section.md"
							download="btca-AGENTS-section.md"
							class="bc-iconBtn"
							title="Download"
						>
							<Download size={16} />
						</a>
						<CopyButton text={EXAMPLE_AGENTS_SECTION} label="Copy AGENTS.md section" />
					</div>
				</div>
				<div class="bc-codeFrame max-h-64 overflow-y-auto">
					<div class="p-4">
						<pre
							class="m-0 whitespace-pre-wrap text-sm leading-relaxed text-[color:hsl(var(--bc-fg))]">{EXAMPLE_AGENTS_SECTION}</pre>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- Next Steps -->
	<section id="next-steps" class="scroll-mt-28 border-t border-[color:hsl(var(--bc-border))] pt-10">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>You're ready!</span>
		</div>

		<h2 class="mt-3 text-2xl font-semibold tracking-tight">Start asking questions</h2>

		<div class="mt-6 grid gap-4 md:grid-cols-2">
			<div class="bc-card bc-ring bc-cardHover p-5">
				<div class="text-sm font-semibold">Quick question</div>
				<p class="mt-2 text-sm bc-prose">
					Ask a one-off question about any of your configured resources.
				</p>
				<div class="mt-3 bc-codeFrame">
					<div class="p-3">
						{#if shikiStore.highlighter}
							{@html shikiStore.highlighter.codeToHtml(
								'btca ask --resource svelte --question "How do stores work?"',
								{
									theme: shikiTheme,
									lang: 'bash',
									rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
								}
							)}
						{:else}
							<pre class="m-0 text-sm"><code
									>btca ask --resource svelte --question "How do stores work?"</code
								></pre>
						{/if}
					</div>
				</div>
			</div>

			<div class="bc-card bc-ring bc-cardHover p-5">
				<div class="text-sm font-semibold">Interactive TUI</div>
				<p class="mt-2 text-sm bc-prose">
					Launch the TUI and use @mentions to query resources interactively.
				</p>
				<div class="mt-3 bc-codeFrame">
					<div class="p-3">
						{#if shikiStore.highlighter}
							{@html shikiStore.highlighter.codeToHtml('btca', {
								theme: shikiTheme,
								lang: 'bash',
								rootStyle: 'background-color: transparent; padding: 0; margin: 0;'
							})}
						{:else}
							<pre class="m-0 text-sm"><code>btca</code></pre>
						{/if}
					</div>
				</div>
			</div>
		</div>

		<div class="mt-6 flex flex-wrap gap-3">
			<a href="/commands" class="bc-chip">View all commands</a>
			<a href="/config" class="bc-chip">Advanced configuration</a>
		</div>
	</section>
</section>
