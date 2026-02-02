<script lang="ts">
	import { Bot } from '@lucide/svelte';
</script>

<section class="og-stage">
	<div class="og-card">
		<div aria-hidden="true" class="og-glow"></div>

		<header class="og-header">
			<div class="og-brand">
				<div class="og-mark">
					<Bot size={24} strokeWidth={2.25} />
				</div>
				<div class="leading-tight">
					<div class="og-title">Better Context</div>
					<div class="og-subtitle">btca CLI</div>
				</div>
			</div>

			<div class="og-url">btca.dev</div>
		</header>

		<div class="og-body">
			<div class="og-pill">Search Agent</div>

			<h1 class="og-headline">
				Better Context for
				<span class="og-accent">You and Your Agents</span>
			</h1>

			<p class="og-lede">
				Search real repos with the CLI or the web app, and get answers grounded in source code.
			</p>
		</div>

		<div class="og-footer">
			<div class="og-list">
				<div class="og-listItem">
					<span class="og-dot"></span>
					<span>Subcommands: ask · chat · serve · open</span>
				</div>
				<div class="og-listItem">
					<span class="og-dot"></span>
					<span>Built with Bun + Effect + SvelteKit</span>
				</div>
			</div>

			<div class="og-code">
				<pre><code
						>bun add -g btca
btca ask -r svelte -q "How do I use remote functions?"</code
					></pre>
			</div>
		</div>
	</div>
</section>

<style>
	.og-stage {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 40px 0;
	}

	.og-card {
		position: relative;
		width: 1200px;
		height: 630px;
		overflow: hidden;
		border-radius: 24px;
		border: 1px solid color-mix(in oklab, hsl(var(--bc-border)) 65%, transparent);
		background: radial-gradient(
			120% 120% at 8% 0%,
			color-mix(in oklab, hsl(var(--bc-accent)) 25%, #0a0f16) 0%,
			#0b0b0b 45%,
			#0a0f16 100%
		);
		box-shadow:
			0 40px 120px rgba(0, 0, 0, 0.55),
			inset 0 0 0 1px rgba(255, 255, 255, 0.04);
		padding: 56px 60px;
		color: hsl(var(--bc-fg));
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.og-glow {
		position: absolute;
		inset: -40% 0 0 -10%;
		background: radial-gradient(
			60% 60% at 15% 0%,
			color-mix(in oklab, hsl(var(--bc-accent)) 55%, transparent),
			transparent 70%
		);
		opacity: 0.6;
		pointer-events: none;
	}

	.og-header {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		z-index: 1;
	}

	.og-brand {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.og-mark {
		width: 56px;
		height: 56px;
		border-radius: 18px;
		display: grid;
		place-items: center;
		background: linear-gradient(135deg, hsl(var(--bc-accent)), #6aa7ff);
		box-shadow: 0 12px 24px color-mix(in oklab, hsl(var(--bc-accent)) 35%, transparent);
		color: #0b1220;
	}

	.og-title {
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.og-subtitle {
		font-size: 14px;
		color: color-mix(in oklab, hsl(var(--bc-fg)) 70%, transparent);
	}

	.og-url {
		font-size: 14px;
		color: color-mix(in oklab, hsl(var(--bc-fg)) 60%, transparent);
	}

	.og-body {
		position: relative;
		z-index: 1;
		max-width: 980px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.og-pill {
		align-self: flex-start;
		border-radius: 999px;
		padding: 8px 16px;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: 0.02em;
		background: color-mix(in oklab, hsl(var(--bc-accent)) 18%, transparent);
		color: color-mix(in oklab, hsl(var(--bc-accent)) 78%, white);
		border: 1px solid color-mix(in oklab, hsl(var(--bc-accent)) 60%, transparent);
	}

	.og-headline {
		font-size: 60px;
		line-height: 1.05;
		letter-spacing: -0.02em;
		font-weight: 650;
		text-wrap: balance;
	}

	.og-accent {
		color: hsl(var(--bc-accent));
	}

	.og-lede {
		font-size: 20px;
		color: color-mix(in oklab, hsl(var(--bc-fg)) 75%, transparent);
		max-width: 640px;
	}

	.og-footer {
		position: relative;
		z-index: 1;
		margin-top: auto;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 28px;
	}

	.og-list {
		display: flex;
		flex-direction: column;
		gap: 16px;
		font-size: 16px;
		color: color-mix(in oklab, hsl(var(--bc-fg)) 75%, transparent);
	}

	.og-listItem {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.og-dot {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: hsl(var(--bc-accent));
		box-shadow: 0 0 12px color-mix(in oklab, hsl(var(--bc-accent)) 45%, transparent);
	}

	.og-code {
		min-width: 520px;
		border-radius: 18px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		background: rgba(15, 15, 15, 0.72);
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.02);
	}

	.og-code pre {
		margin: 0;
		padding: 18px 22px;
		font-family: var(--font-family-geist-mono);
		font-size: 16px;
		line-height: 1.5;
		color: color-mix(in oklab, hsl(var(--bc-fg)) 85%, transparent);
		white-space: pre-wrap;
	}
</style>
