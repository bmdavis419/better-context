import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { FiletypeParserOptions } from '@opentui/core';

import markdown_wasm from '@opentui/core/assets/markdown/tree-sitter-markdown.wasm' with { type: 'file' };
import markdown_highlights from '@opentui/core/assets/markdown/highlights.scm' with { type: 'file' };
import markdown_injections from '@opentui/core/assets/markdown/injections.scm' with { type: 'file' };
import markdown_inline_wasm from '@opentui/core/assets/markdown_inline/tree-sitter-markdown_inline.wasm' with { type: 'file' };
import markdown_inline_highlights from '@opentui/core/assets/markdown_inline/highlights.scm' with { type: 'file' };

export function getParsers(): FiletypeParserOptions[] {
	const base = dirname(fileURLToPath(import.meta.url));
	return [
		{
			filetype: 'markdown',
			wasm: resolve(base, markdown_wasm),
			queries: {
				highlights: [resolve(base, markdown_highlights)],
				injections: [resolve(base, markdown_injections)]
			},
			injectionMapping: {
				nodeTypes: { inline: 'markdown_inline', pipe_table_cell: 'markdown_inline' },
				infoStringMap: { markdown: 'markdown', md: 'markdown' }
			}
		},
		{
			filetype: 'markdown_inline',
			wasm: resolve(base, markdown_inline_wasm),
			queries: { highlights: [resolve(base, markdown_inline_highlights)] }
		}
	];
}
