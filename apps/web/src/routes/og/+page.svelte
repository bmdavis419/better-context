<script lang="ts">
	import { Bot } from '@lucide/svelte';
</script>

<section class="mx-auto w-[1200px] max-w-full">
	<div class="relative h-[630px] overflow-hidden bc-card bc-ring">
		<div aria-hidden="true" class="absolute inset-0 bc-appBg"></div>

		<div class="relative flex h-full flex-col p-16">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-4">
					<div class="bc-logoMark" style="width: 56px; height: 56px; border-radius: 0;">
						<Bot size={24} strokeWidth={2.25} />
					</div>
					<div class="leading-tight">
						<div class="text-xl bc-title">Better Context</div>
						<div class="text-sm bc-subtitle">btca · local-first code answer engine</div>
					</div>
				</div>

				<div class="text-sm bc-muted">github.com/bmdavis419/better-context</div>
			</div>

			<div class="mt-14 max-w-[980px]">
				<div class="bc-badge bc-badgeAccent">
					<span class="bc-kickerDot"></span>
					<span>Agent-grade docs search</span>
				</div>

				<h1 class="mt-6 text-balance text-6xl bc-h1">
					Ask the codebase.
					<span class="text-[color:hsl(var(--bc-accent))]">Get receipts.</span>
				</h1>

				<p class="mt-5 text-pretty text-xl bc-prose">
					Clones repos locally, searches the real source, answers with grounded snippets.
				</p>
			</div>

			<div class="mt-auto flex items-end justify-between gap-10">
				<div class="flex flex-col gap-3 text-base bc-prose">
					<div class="flex items-center gap-3">
						<span class="size-2 bg-[color:hsl(var(--bc-fg))]"></span>
						<span>Subcommands: ask · chat · serve · open</span>
					</div>
					<div class="flex items-center gap-3">
						<span class="size-2 bg-[color:hsl(var(--bc-fg))]"></span>
						<span>Built with Bun + Effect + SvelteKit</span>
					</div>
				</div>

				<div class="w-[560px] bc-codeFrame">
					<div class="p-5">
						<pre class="m-0 whitespace-pre-wrap text-base leading-relaxed"><code
								>bun add -g btca
btca ask -r svelte -q "How do stores work?"</code
							></pre>
					</div>
				</div>
			</div>
		</div>
	</div>
</section>
