<script lang="ts">
	const supportEmail = 'support@davis7.sh';
	const faqs = [
		{
			question: 'Do I have to pay for the CLI?',
			answer:
				"No! The CLI can be used through one of 7 different providers, it's completely bring your own model."
		},
		{
			question: 'How do I cancel my subscription?',
			answer: 'Head to settings -> billing -> manage subscription'
		},
		{
			question: 'How do I report a bug?',
			answer: 'GitHub issues are the best way to report bugs'
		}
	];
</script>

<div class="flex flex-1 flex-col overflow-hidden">
	<div class="mx-auto w-full max-w-5xl px-8 pt-8">
		<div class="mb-6">
			<h1 class="text-2xl font-semibold">Support</h1>
			<p class="bc-muted mt-2 text-xl">Need help? Email us at</p>
			<a
				href={`mailto:${supportEmail}`}
				class="mt-2 inline-flex text-3xl font-semibold text-[color:var(--btca-brand)] underline dark:text-[color:var(--btca-brand-light)]"
			>
				{supportEmail}
			</a>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto">
		<div class="mx-auto w-full max-w-5xl space-y-6 px-8 pb-8">
			<div class="bc-card p-6">
				<h2 class="text-lg font-semibold">FAQs</h2>
				<p class="bc-muted mt-1 text-sm">Stubbed answers for now. Replace as needed.</p>
				<div class="mt-4 space-y-4">
					{#each faqs as faq}
						<div class="rounded-lg border border-[hsl(var(--bc-border))] p-4">
							<p class="text-sm font-semibold">{faq.question}</p>
							<p class="bc-muted mt-1 text-sm">{faq.answer}</p>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
</div>
