import type { FiletypeParserOptions } from '@opentui/core';

// These parsers are loaded on-demand by OpenTUI's TreeSitterClient.
// The wasm/query assets are remote URLs, so first-use requires network access.
export const parsers = [
	{
		filetype: 'json',
		wasm: 'https://cdn.jsdelivr.net/npm/tree-sitter-json@0.24.8/tree-sitter-json.wasm',
		queries: {
			highlights: ['https://cdn.jsdelivr.net/npm/tree-sitter-json@0.24.8/queries/highlights.scm']
		}
	},
	{
		filetype: 'html',
		wasm: 'https://cdn.jsdelivr.net/npm/tree-sitter-html@0.23.2/tree-sitter-html.wasm',
		queries: {
			highlights: ['https://cdn.jsdelivr.net/npm/tree-sitter-html@0.23.2/queries/highlights.scm'],
			injections: ['https://cdn.jsdelivr.net/npm/tree-sitter-html@0.23.2/queries/injections.scm']
		}
	},
	{
		filetype: 'css',
		wasm: 'https://cdn.jsdelivr.net/npm/tree-sitter-css@0.23.2/tree-sitter-css.wasm',
		queries: {
			highlights: ['https://cdn.jsdelivr.net/npm/tree-sitter-css@0.23.2/queries/highlights.scm']
		}
	},
	{
		filetype: 'python',
		wasm: 'https://cdn.jsdelivr.net/npm/tree-sitter-python@0.23.6/tree-sitter-python.wasm',
		queries: {
			highlights: ['https://cdn.jsdelivr.net/npm/tree-sitter-python@0.23.6/queries/highlights.scm']
		}
	},
	{
		filetype: 'rust',
		wasm: 'https://cdn.jsdelivr.net/npm/tree-sitter-rust@0.23.2/tree-sitter-rust.wasm',
		queries: {
			highlights: ['https://cdn.jsdelivr.net/npm/tree-sitter-rust@0.23.2/queries/highlights.scm']
		}
	},
	{
		filetype: 'go',
		wasm: 'https://cdn.jsdelivr.net/npm/tree-sitter-go@0.23.4/tree-sitter-go.wasm',
		queries: {
			highlights: ['https://cdn.jsdelivr.net/npm/tree-sitter-go@0.23.4/queries/highlights.scm']
		}
	},
	{
		filetype: 'yaml',
		wasm: 'https://cdn.jsdelivr.net/npm/@tree-sitter-grammars/tree-sitter-yaml@0.7.1/tree-sitter-yaml.wasm',
		queries: {
			highlights: [
				'https://cdn.jsdelivr.net/npm/@tree-sitter-grammars/tree-sitter-yaml@0.7.1/queries/highlights.scm'
			]
		}
	},
	{
		filetype: 'bash',
		wasm: 'https://cdn.jsdelivr.net/npm/tree-sitter-bash@0.23.3/tree-sitter-bash.wasm',
		queries: {
			highlights: ['https://cdn.jsdelivr.net/npm/tree-sitter-bash@0.23.3/queries/highlights.scm']
		}
	}
] satisfies FiletypeParserOptions[];
