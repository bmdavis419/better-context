import { tool } from '@opencode-ai/plugin';
import { MorphClient } from '@morphllm/morphsdk';
import { Effect } from 'effect';

const search = (query: string) =>
	Effect.gen(function* () {
		const morph = new MorphClient({
			apiKey: Bun.env.MORPH_API_KEY
		});

		const result = yield* Effect.promise(() =>
			morph.warpGrep.execute({
				query,
				repoRoot: '/Users/davis/Developer/better-context'
			})
		);

		if (result.success && result.contexts) {
			let content = '';
			for (const ctx of result.contexts) {
				const file = Bun.file('./bruh.txt');
				yield* Effect.promise(() => file.write(ctx.content));
				content += ctx.content + '\n';
			}
			return content;
		} else {
			return result.error ?? 'No results found';
		}
	});

export default tool({
	description:
		'Search the codebase with targeted natural language query describing what you`re trying to accomplish',
	args: {
		query: tool.schema.string().describe('The query to search the codebase for')
	},
	execute: async ({ query }) => {
		return Effect.runPromise(search(query));
	}
});
