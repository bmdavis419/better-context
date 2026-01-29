import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { Marked, type Token, type Tokens } from 'marked';
import { Result } from 'better-result';

// Import languages
import typescript from '@shikijs/langs/typescript';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import bash from '@shikijs/langs/bash';
import python from '@shikijs/langs/python';
import rust from '@shikijs/langs/rust';
import go from '@shikijs/langs/go';
import css from '@shikijs/langs/css';
import html from '@shikijs/langs/html';
import yaml from '@shikijs/langs/yaml';
import markdown from '@shikijs/langs/markdown';
import sql from '@shikijs/langs/sql';
import diff from '@shikijs/langs/diff';

// Import theme (dark-plus matches the web app)
import darkPlus from '@shikijs/themes/dark-plus';

// Color options type used throughout the renderer
export interface ColorOptions {
	accent: string;
	text: string;
	textMuted: string;
	textSubtle: string;
	success: string;
	info: string;
	error: string;
}

// Styled chunk for rendering - simpler than full HAST
export interface StyledChunk {
	text: string;
	fg?: string;
	bg?: string;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	isCodeBlock?: boolean; // Flag to indicate this is part of a code block
}

const SUPPORTED_LANGS = [
	'typescript',
	'ts',
	'javascript',
	'js',
	'json',
	'bash',
	'sh',
	'shell',
	'python',
	'py',
	'rust',
	'rs',
	'go',
	'css',
	'html',
	'yaml',
	'yml',
	'markdown',
	'md',
	'sql',
	'diff'
];

// Singleton highlighter instance
let highlighterPromise: Promise<HighlighterCore> | null = null;

async function getHighlighter(): Promise<HighlighterCore> {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighterCore({
			langs: [
				typescript,
				javascript,
				json,
				bash,
				python,
				rust,
				go,
				css,
				html,
				yaml,
				markdown,
				sql,
				diff
			],
			themes: [darkPlus],
			engine: createJavaScriptRegexEngine()
		});
	}
	return highlighterPromise;
}

// Map language aliases to canonical names
function normalizeLanguage(lang: string): string {
	const aliases: Record<string, string> = {
		ts: 'typescript',
		js: 'javascript',
		sh: 'bash',
		shell: 'bash',
		py: 'python',
		rs: 'rust',
		yml: 'yaml',
		md: 'markdown'
	};
	return aliases[lang.toLowerCase()] || lang.toLowerCase();
}

// Style definitions for markdown elements
function getMarkdownStyles(colors: ColorOptions): Record<string, Partial<StyledChunk>> {
	return {
		heading: { fg: colors.accent, bold: true },
		bold: { bold: true },
		italic: { italic: true },
		link: { fg: colors.info, underline: true },
		code: { fg: colors.success },
		blockquote: { fg: colors.textMuted, italic: true },
		list: { fg: colors.text },
		default: { fg: colors.text }
	};
}

// Extract color from shiki inline style
function extractColorFromStyle(style: string): string | undefined {
	const match = style.match(/color:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})/);
	return match?.[1];
}

// Convert shiki HAST to styled chunks
function shikiHastToChunks(node: unknown): StyledChunk[] {
	if (!node || typeof node !== 'object') return [];

	const n = node as Record<string, unknown>;

	if (n.type === 'text' && typeof n.value === 'string') {
		return [{ text: n.value }];
	}

	if (n.type === 'element' || n.type === 'root') {
		const props = n.properties as Record<string, unknown> | undefined;
		const style = props?.style as string | undefined;
		const fg = style ? extractColorFromStyle(style) : undefined;

		const children = Array.isArray(n.children) ? n.children : [];
		const childChunks = children.flatMap((child) => shikiHastToChunks(child));

		// Apply color to all child chunks if we have one
		if (fg) {
			return childChunks.map((chunk) => ({ ...chunk, fg: chunk.fg || fg }));
		}

		return childChunks;
	}

	return [];
}

// Parse markdown and convert to styled chunks
async function markdownToChunks(content: string, colors: ColorOptions): Promise<StyledChunk[]> {
	const highlighter = await getHighlighter();
	const marked = new Marked();
	const tokens = marked.lexer(content);
	const styles = getMarkdownStyles(colors);

	const chunks: StyledChunk[] = [];

	for (const token of tokens) {
		const tokenChunks = await tokenToChunks(token, highlighter, colors, styles);
		chunks.push(...tokenChunks);
	}

	return chunks;
}

async function tokenToChunks(
	token: Token,
	highlighter: HighlighterCore,
	colors: ColorOptions,
	styles: Record<string, Partial<StyledChunk>>
): Promise<StyledChunk[]> {
	switch (token.type) {
		case 'heading': {
			const t = token as Tokens.Heading;
			const prefix = '#'.repeat(t.depth) + ' ';
			const childChunks = await inlineTokensToChunks(t.tokens || [], highlighter, colors, styles);
			const headingStyle = styles.heading || {};
			return [
				{ text: prefix, ...headingStyle },
				...childChunks.map((c) => ({ ...c, ...headingStyle })),
				{ text: '\n' }
			];
		}

		case 'paragraph': {
			const t = token as Tokens.Paragraph;
			const childChunks = await inlineTokensToChunks(t.tokens || [], highlighter, colors, styles);
			return [...childChunks, { text: '\n' }];
		}

		case 'text': {
			const t = token as Tokens.Text;
			if ('tokens' in t && t.tokens) {
				return inlineTokensToChunks(t.tokens, highlighter, colors, styles);
			}
			return [{ text: t.text, fg: colors.text }];
		}

		case 'code': {
			const t = token as Tokens.Code;
			const lang = t.lang ? normalizeLanguage(t.lang) : 'text';
			const codeBg = '#1e1e1e'; // VS Code dark background

			if (SUPPORTED_LANGS.includes(lang) || SUPPORTED_LANGS.includes(t.lang || '')) {
				const hastResult = Result.try(() =>
					highlighter.codeToHast(t.text, {
						lang: lang,
						theme: 'dark-plus'
					})
				);
				if (hastResult.isOk()) {
					const codeChunks = shikiHastToChunks(hastResult.value);
					// Mark all chunks as code block and add background
					const styledCodeChunks = codeChunks.map((c) => ({
						...c,
						bg: codeBg,
						isCodeBlock: true
					}));
					return [{ text: '\n' }, ...styledCodeChunks, { text: '\n' }];
				}
			}

			// Fallback: plain code block
			return [
				{ text: '\n' },
				{ text: t.text, fg: colors.success, bg: codeBg, isCodeBlock: true },
				{ text: '\n' }
			];
		}

		case 'codespan': {
			const t = token as Tokens.Codespan;
			return [{ text: t.text, ...styles.code }];
		}

		case 'strong': {
			const t = token as Tokens.Strong;
			const childChunks = await inlineTokensToChunks(t.tokens || [], highlighter, colors, styles);
			return childChunks.map((c) => ({ ...c, bold: true }));
		}

		case 'em': {
			const t = token as Tokens.Em;
			const childChunks = await inlineTokensToChunks(t.tokens || [], highlighter, colors, styles);
			return childChunks.map((c) => ({ ...c, italic: true }));
		}

		case 'link': {
			const t = token as Tokens.Link;
			const childChunks = await inlineTokensToChunks(t.tokens || [], highlighter, colors, styles);
			return childChunks.map((c) => ({ ...c, ...styles.link }));
		}

		case 'list': {
			const t = token as Tokens.List;
			const chunks: StyledChunk[] = [];

			for (let i = 0; i < t.items.length; i++) {
				const item = t.items[i];
				const bullet = t.ordered ? `${(t.start || 1) + i}. ` : '• ';
				chunks.push({ text: bullet, fg: colors.accent });

				for (const subToken of item?.tokens || []) {
					const subChunks = await tokenToChunks(subToken, highlighter, colors, styles);
					// Filter out trailing newlines from sub-tokens since we add our own
					const filtered = subChunks.filter(
						(c, idx) => !(idx === subChunks.length - 1 && c.text === '\n')
					);
					chunks.push(...filtered);
				}
				// Add newline after each list item
				chunks.push({ text: '\n' });
			}

			return chunks;
		}

		case 'blockquote': {
			const t = token as Tokens.Blockquote;
			const chunks: StyledChunk[] = [];

			for (const subToken of t.tokens || []) {
				const subChunks = await tokenToChunks(subToken, highlighter, colors, styles);
				// Prefix each line with >
				for (const chunk of subChunks) {
					if (chunk.text.includes('\n')) {
						const lines = chunk.text.split('\n');
						for (let i = 0; i < lines.length; i++) {
							if (i > 0) chunks.push({ text: '\n' });
							if (lines[i]) {
								chunks.push({ text: '> ', fg: colors.textMuted });
								chunks.push({ ...chunk, text: lines[i] as string, ...styles.blockquote });
							}
						}
					} else {
						chunks.push({ text: '> ', fg: colors.textMuted });
						chunks.push({ ...chunk, ...styles.blockquote });
					}
				}
			}

			return chunks;
		}

		case 'hr':
			return [{ text: '───────────────────────────────────────\n', fg: colors.textMuted }];

		case 'br':
			return [{ text: '\n' }];

		case 'space':
			return [{ text: '\n' }];

		default:
			// For unknown tokens, try to extract raw text
			if ('raw' in token && typeof token.raw === 'string') {
				return [{ text: token.raw, fg: colors.text }];
			}
			return [];
	}
}

async function inlineTokensToChunks(
	tokens: Token[],
	highlighter: HighlighterCore,
	colors: ColorOptions,
	styles: Record<string, Partial<StyledChunk>>
): Promise<StyledChunk[]> {
	const result: StyledChunk[] = [];
	for (const token of tokens) {
		const chunks = await tokenToChunks(token, highlighter, colors, styles);
		result.push(...chunks);
	}
	return result;
}

export interface MarkdownRenderOptions {
	colors: ColorOptions;
}

export async function renderMarkdownToChunks(
	content: string,
	options: MarkdownRenderOptions
): Promise<StyledChunk[]> {
	return markdownToChunks(content, options.colors);
}
