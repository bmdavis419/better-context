import { createHighlighter, type Highlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;
let highlighterInstance: Highlighter | null = null;
let generation = 0;

export const getChatHighlighter = () => {
	if (!highlighterPromise) {
		generation += 1;
		const current = generation;
		highlighterPromise = createHighlighter({
			themes: ['dark-plus', 'light-plus'],
			langs: [
				'elixir',
				'typescript',
				'tsx',
				'svelte',
				'json',
				'text',
				'javascript',
				'jsx',
				'html',
				'css',
				'bash',
				'shell',
				'python',
				'rust',
				'go'
			]
		}).then((highlighter) => {
			if (current !== generation) {
				highlighter.dispose();
				return highlighter;
			}
			highlighterInstance = highlighter;
			return highlighter;
		});
	}

	return highlighterPromise;
};

export const disposeChatHighlighter = () => {
	if (!highlighterPromise && !highlighterInstance) return;
	generation += 1;
	highlighterInstance?.dispose();
	highlighterInstance = null;
	highlighterPromise = null;
};
