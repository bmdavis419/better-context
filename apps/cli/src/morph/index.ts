import { MorphClient } from '@morphllm/morphsdk';
import { Effect } from 'effect';

const program = Effect.gen(function* () {
	const morph = new MorphClient({ apiKey: 'sk-DXsp2FQdXJktoVK97hlj6Z7QhbhU5g2EPPsETga_6qUKwKrC' });

	const result = yield* Effect.promise(() =>
		morph.warpGrep.execute({
			query: 'How does the btca config command work?',
			repoRoot: '/Users/davis/Developer/better-context'
		})
	);

	if (result.success && result.contexts) {
		for (const ctx of result.contexts) {
			yield* Effect.log(ctx.content);
		}
	} else {
		yield* Effect.log(result.error);
	}
});

Effect.runPromise(program);
