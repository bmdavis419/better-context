import { RGBA, SyntaxStyle } from '@opentui/core';

import { colors } from './theme.ts';

export const syntaxStyle = SyntaxStyle.fromStyles({
	default: { fg: RGBA.fromHex(colors.text), bg: RGBA.fromHex(colors.bg) },
	conceal: { fg: RGBA.fromHex(colors.textSubtle), bg: RGBA.fromHex(colors.bg) },

	keyword: { fg: RGBA.fromHex('#569cd6'), bold: true },
	'keyword.operator': { fg: RGBA.fromHex('#569cd6') },
	string: { fg: RGBA.fromHex('#ce9178') },
	comment: { fg: RGBA.fromHex('#6a9955'), italic: true },
	number: { fg: RGBA.fromHex('#b5cea8') },
	function: { fg: RGBA.fromHex('#dcdcaa') },
	type: { fg: RGBA.fromHex('#4ec9b0') },
	constant: { fg: RGBA.fromHex('#4fc1ff') },
	property: { fg: RGBA.fromHex('#9cdcfe') },
	variable: { fg: RGBA.fromHex('#9cdcfe') },
	operator: { fg: RGBA.fromHex('#d4d4d4') },
	'punctuation.delimiter': { fg: RGBA.fromHex('#d4d4d4') },
	'punctuation.special': { fg: RGBA.fromHex(colors.textMuted) },

	// Markdown groups used by OpenTUI's MarkdownRenderable (note: base fallback is only the first segment)
	'markup.heading.1': { fg: RGBA.fromHex(colors.accent), bold: true },
	'markup.heading.2': { fg: RGBA.fromHex(colors.accent), bold: true },
	'markup.heading.3': { fg: RGBA.fromHex(colors.accent), bold: true },
	'markup.heading.4': { fg: RGBA.fromHex(colors.accent), bold: true },
	'markup.heading.5': { fg: RGBA.fromHex(colors.accent), bold: true },
	'markup.heading.6': { fg: RGBA.fromHex(colors.accent), bold: true },
	'markup.list': { fg: RGBA.fromHex(colors.accent) },
	'markup.link': { fg: RGBA.fromHex(colors.info), underline: true },
	'markup.link.label': { fg: RGBA.fromHex(colors.info), underline: true },
	'markup.link.url': { fg: RGBA.fromHex(colors.info), underline: true },
	'markup.strong': { bold: true },
	'markup.italic': { italic: true },
	'markup.strikethrough': { fg: RGBA.fromHex(colors.textMuted), dim: true },
	'markup.raw': { fg: RGBA.fromHex(colors.success) },
	'markup.raw.block': { fg: RGBA.fromHex(colors.success) }
});
