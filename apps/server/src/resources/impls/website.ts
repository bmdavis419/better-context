import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Result } from 'better-result';
import { load } from 'cheerio';

import { CommonHints } from '../../errors.ts';
import { Metrics } from '../../metrics/index.ts';
import { LIMITS } from '../../validation/index.ts';
import { ResourceError, resourceNameToKey } from '../helpers.ts';
import { WebsiteResourceSchema } from '../schema.ts';
import type { BtcaFsResource, BtcaWebsiteResourceArgs } from '../types.ts';

type RobotsRules = {
	allows: string[];
	disallows: string[];
};

type CrawlQueueItem = {
	url: string;
	depth: number;
};

type CrawledPage = {
	url: string;
	title: string;
	markdown: string;
	headings: string[];
	fetchedAt: string;
};

type CrawlResult = {
	pages: CrawledPage[];
	scopePath: string;
};

type MarkdownVariantSupport = {
	dotMd: boolean | null;
	slashDotMd: boolean | null;
};

type WebsiteManifestPage = {
	url: string;
	title: string;
	filePath: string;
	fetchedAt: string;
};

type WebsiteManifest = {
	version: 1;
	url: string;
	scopePath: string;
	crawledAt: string;
	maxPages: number;
	maxDepth: number;
	pageCount: number;
	pages: WebsiteManifestPage[];
};

const MANIFEST_FILE = '.btca-website-manifest.json';
const INDEX_FILE = '_index.jsonl';
const MAX_FETCH_BYTES = 2 * 1024 * 1024;
const BOT_USER_AGENT = 'btca-website-crawler/1.0';
const MAX_REDIRECTS = 5;

const looksLikeHtml = (value: string) => {
	const head = value.trimStart().slice(0, 400).toLowerCase();
	if (!head.startsWith('<')) return false;
	return (
		head.includes('<!doctype') ||
		head.includes('<html') ||
		head.includes('<head') ||
		head.includes('<body')
	);
};

const isMarkdownVariantPath = (pathname: string) =>
	pathname === '/.md' || pathname.endsWith('/.md') || pathname.endsWith('.md');

const buildDotMdUrl = (canonicalUrl: string) => {
	const url = new URL(canonicalUrl);
	if (url.pathname === '/') url.pathname = '/.md';
	else url.pathname = `${url.pathname}.md`;
	return url.toString();
};

const buildSlashDotMdUrl = (canonicalUrl: string) => {
	const url = new URL(canonicalUrl);
	if (url.pathname === '/') url.pathname = '/.md';
	else url.pathname = `${url.pathname}/.md`;
	return url.toString();
};

const canonicalizeMarkdownVariantUrl = (value: string) => {
	const parsedResult = Result.try(() => new URL(value));
	return parsedResult.match({
		ok: (url) => {
			const pathname = url.pathname;
			if (pathname === '/.md') {
				url.pathname = '/';
				return url.toString();
			}

			if (pathname.endsWith('/.md')) {
				const next = pathname.slice(0, -'/.md'.length) || '/';
				url.pathname = next.startsWith('/') ? next : `/${next}`;
				return url.toString();
			}

			if (pathname.endsWith('.md')) {
				const segments = pathname.split('/');
				const last = segments[segments.length - 1] ?? '';
				const stem = last.slice(0, -'.md'.length);

				// Only strip `.md` when the stem itself has no dots (so `foo.md` -> `foo`,
				// but `foo.v1.md` stays as-is).
				if (stem && !stem.includes('.')) {
					segments[segments.length - 1] = stem;
					const next = segments.join('/') || '/';
					url.pathname = next.startsWith('/') ? next : `/${next}`;
					return url.toString();
				}
			}

			return url.toString();
		},
		err: () => value
	});
};

const fileExists = async (filePath: string) => {
	const result = await Result.tryPromise(() => fs.stat(filePath));
	return result.match({
		ok: () => true,
		err: () => false
	});
};

const directoryExists = async (filePath: string) => {
	const result = await Result.tryPromise(() => fs.stat(filePath));
	return result.match({
		ok: (stats) => stats.isDirectory(),
		err: () => false
	});
};

const readManifest = async (resourcePath: string): Promise<WebsiteManifest | null> => {
	const result = await Result.tryPromise(async () => {
		const content = await Bun.file(path.join(resourcePath, MANIFEST_FILE)).text();
		const parsed = JSON.parse(content) as Partial<WebsiteManifest>;
		if (
			parsed.version !== 1 ||
			typeof parsed.url !== 'string' ||
			typeof parsed.scopePath !== 'string' ||
			typeof parsed.crawledAt !== 'string' ||
			typeof parsed.maxPages !== 'number' ||
			typeof parsed.maxDepth !== 'number' ||
			typeof parsed.pageCount !== 'number' ||
			!Array.isArray(parsed.pages)
		) {
			return null;
		}
		return parsed as WebsiteManifest;
	});

	return result.match({
		ok: (manifest) => manifest,
		err: () => null
	});
};

const hasSnapshotFiles = async (resourcePath: string) => {
	const [hasPagesDir, hasIndexFile] = await Promise.all([
		directoryExists(path.join(resourcePath, 'pages')),
		fileExists(path.join(resourcePath, INDEX_FILE))
	]);
	return hasPagesDir && hasIndexFile;
};

const isManifestFresh = (manifest: WebsiteManifest, ttlHours: number) => {
	const crawledAtMs = Date.parse(manifest.crawledAt);
	if (Number.isNaN(crawledAtMs)) return false;
	const ttlMs = ttlHours * 60 * 60 * 1000;
	return Date.now() - crawledAtMs < ttlMs;
};

const validateWebsiteUrl = (url: string) => {
	const result = WebsiteResourceSchema.shape.url.safeParse(url);
	if (result.success) return { success: true as const };
	return {
		success: false as const,
		error: result.error.errors[0]?.message ?? 'Invalid website URL'
	};
};

const normalizeUrl = (value: string, base?: string): string | null => {
	const result = Result.try(() => new URL(value, base));
	return result.match({
		ok: (url) => {
			if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
			url.hash = '';
			url.search = '';
			if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
				url.pathname = url.pathname.slice(0, -1);
			}
			return url.toString();
		},
		err: () => null
	});
};

const scopePathFromStartUrl = (startUrl: URL) => {
	const trimmed = startUrl.pathname.replace(/\/+$/, '');
	if (trimmed.length === 0) return '/';
	const segments = trimmed.split('/').filter(Boolean);
	const lastSegment = segments[segments.length - 1] ?? '';
	if (!lastSegment.includes('.')) return trimmed;
	const parent = trimmed.slice(0, trimmed.lastIndexOf('/'));
	return parent.length > 0 ? parent : '/';
};

const isInScope = (candidate: URL, origin: string, scopePath: string) => {
	if (candidate.origin !== origin) return false;
	if (scopePath === '/') return true;
	return candidate.pathname === scopePath || candidate.pathname.startsWith(`${scopePath}/`);
};

const hasBinaryExtension = (candidateUrl: URL) => {
	const ext = path.extname(candidateUrl.pathname).toLowerCase();
	return new Set([
		'.png',
		'.jpg',
		'.jpeg',
		'.gif',
		'.webp',
		'.svg',
		'.ico',
		'.pdf',
		'.zip',
		'.tar',
		'.gz',
		'.mp4',
		'.mp3',
		'.woff',
		'.woff2',
		'.ttf',
		'.eot'
	]).has(ext);
};

const decodeXmlEntities = (value: string) =>
	value
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");

const parseRobots = (robotsText: string): RobotsRules => {
	type Group = { agents: string[]; allows: string[]; disallows: string[] };
	const groups: Group[] = [];
	let current: Group = { agents: [], allows: [], disallows: [] };
	let hasRulesInGroup = false;

	for (const rawLine of robotsText.split('\n')) {
		const line = rawLine.split('#')[0]?.trim() ?? '';
		if (!line) continue;

		const lower = line.toLowerCase();
		if (lower.startsWith('user-agent:')) {
			if (hasRulesInGroup && current.agents.length > 0) {
				groups.push(current);
				current = { agents: [], allows: [], disallows: [] };
				hasRulesInGroup = false;
			}
			const agent = line
				.slice(line.indexOf(':') + 1)
				.trim()
				.toLowerCase();
			if (agent) current.agents.push(agent);
			continue;
		}

		if (lower.startsWith('allow:')) {
			const rule = line.slice(line.indexOf(':') + 1).trim();
			current.allows.push(rule);
			hasRulesInGroup = true;
			continue;
		}

		if (lower.startsWith('disallow:')) {
			const rule = line.slice(line.indexOf(':') + 1).trim();
			current.disallows.push(rule);
			hasRulesInGroup = true;
		}
	}

	if (current.agents.length > 0) groups.push(current);

	const matching = groups.filter((group) =>
		group.agents.some((agent) => agent === '*' || agent === BOT_USER_AGENT.toLowerCase())
	);

	return {
		allows: matching.flatMap((group) => group.allows),
		disallows: matching.flatMap((group) => group.disallows)
	};
};

const isPathAllowedByRobots = (candidatePath: string, rules: RobotsRules) => {
	let best: { len: number; allow: boolean } | null = null;

	const testRules = (paths: string[], allow: boolean) => {
		for (const rawRule of paths) {
			const rule = rawRule.trim();
			if (!rule) continue;
			if (!candidatePath.startsWith(rule)) continue;
			const next = { len: rule.length, allow };
			if (!best || next.len > best.len || (next.len === best.len && next.allow)) {
				best = next;
			}
		}
	};

	testRules(rules.disallows, false);
	testRules(rules.allows, true);

	const winner = best as { len: number; allow: boolean } | null;
	if (!winner) return true;
	return winner.allow;
};

const fetchRobotsRules = async (origin: string, quiet: boolean): Promise<RobotsRules> => {
	const result = await Result.tryPromise(async () => {
		const response = await fetch(`${origin}/robots.txt`, {
			headers: { 'user-agent': BOT_USER_AGENT },
			signal: AbortSignal.timeout(10_000)
		});
		if (!response.ok) return { allows: [], disallows: [] };
		const text = await response.text();
		return parseRobots(text);
	});

	return result.match({
		ok: (rules) => rules,
		err: (error) => {
			if (!quiet) {
				Metrics.error('resource.website.robots.error', { error: Metrics.errorInfo(error) });
			}
			return { allows: [], disallows: [] };
		}
	});
};

const fetchSitemapUrls = async (start: URL, quiet: boolean): Promise<string[]> => {
	const result = await Result.tryPromise(async () => {
		const response = await fetch(`${start.origin}/sitemap.xml`, {
			headers: { 'user-agent': BOT_USER_AGENT },
			signal: AbortSignal.timeout(12_000)
		});
		if (!response.ok) return [];
		const text = await response.text();
		const locMatches = Array.from(text.matchAll(/<loc>(.*?)<\/loc>/gi));
		const urls = locMatches
			.map((match) => match[1]?.trim() ?? '')
			.filter(Boolean)
			.map((value) => decodeXmlEntities(value));
		return urls;
	});

	return result.match({
		ok: (urls) => urls,
		err: (error) => {
			if (!quiet) {
				Metrics.error('resource.website.sitemap.error', { error: Metrics.errorInfo(error) });
			}
			return [];
		}
	});
};

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();

const extractLinksFromMarkdown = (markdown: string, pageUrl: string) => {
	const links = new Set<string>();

	const add = (raw: string) => {
		const trimmed = raw.trim();
		if (!trimmed || trimmed.startsWith('#')) return;
		if (
			trimmed.startsWith('mailto:') ||
			trimmed.startsWith('tel:') ||
			trimmed.startsWith('javascript:')
		) {
			return;
		}

		const normalized = normalizeUrl(trimmed, pageUrl);
		if (!normalized) return;
		const canonical = canonicalizeMarkdownVariantUrl(normalized);
		links.add(canonical);
	};

	// Inline links: [text](url), excluding images: ![alt](url)
	for (const match of markdown.matchAll(
		/(^|[^!])\[[^\]]*?\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
	)) {
		const rawUrl = match[2];
		if (!rawUrl) continue;
		add(rawUrl);
	}

	// Autolinks: <https://example.com>
	for (const match of markdown.matchAll(/<((?:https?:\/\/)[^>\s]+)>/g)) {
		const rawUrl = match[1];
		if (!rawUrl) continue;
		add(rawUrl);
	}

	// Reference definitions: [id]: url
	for (const match of markdown.matchAll(/^\s*\[[^\]]+?\]:\s*(\S+)/gm)) {
		const rawUrl = match[1];
		if (!rawUrl) continue;
		add(rawUrl);
	}

	return Array.from(links);
};

const parseMetaRobots = (html: string) => {
	const $ = load(html);
	const tokens = new Set<string>();

	$('meta[name]').each((_, element) => {
		const name = ($(element).attr('name') ?? '').toLowerCase();
		if (name !== 'robots' && name !== 'googlebot') return;
		const content = ($(element).attr('content') ?? '').toLowerCase();
		for (const token of content.split(',')) {
			const normalized = token.trim();
			if (normalized) tokens.add(normalized);
		}
	});

	return {
		noindex: tokens.has('noindex') || tokens.has('none'),
		nofollow: tokens.has('nofollow') || tokens.has('none')
	};
};

const extractLinks = (html: string, pageUrl: string) => {
	const $ = load(html);
	const links = new Set<string>();

	$('a[href]').each((_, element) => {
		const href = $(element).attr('href');
		if (!href || href.startsWith('#')) return;
		if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
			return;
		}
		const normalized = normalizeUrl(href, pageUrl);
		if (!normalized) return;
		links.add(normalized);
	});

	return Array.from(links);
};

const extractMarkdownTitleAndBody = (markdown: string) => {
	const normalized = markdown.replace(/\r\n/g, '\n');
	const lines = normalized.split('\n');

	let firstContentIndex = 0;
	while (firstContentIndex < lines.length && !lines[firstContentIndex]?.trim())
		firstContentIndex += 1;

	const first = lines[firstContentIndex] ?? '';
	if (first.startsWith('# ')) {
		const title = first.slice(2).trim() || 'Untitled';
		const rest = lines
			.slice(firstContentIndex + 1)
			.join('\n')
			.replace(/^\n+/, '');
		return { title, body: rest };
	}

	return { title: '', body: normalized.trimStart() };
};

const extractMarkdownHeadings = (markdown: string) =>
	Array.from(markdown.matchAll(/^#{1,3}\s+(.+?)\s*$/gm))
		.map((match) => normalizeWhitespace(match[1] ?? ''))
		.filter(Boolean)
		.slice(0, 100);

const wrapMarkdownSnapshot = (args: {
	canonicalUrl: string;
	markdown: string;
	titleHint: string;
}) => {
	const { title, body } = extractMarkdownTitleAndBody(args.markdown);
	const finalTitle =
		title || args.titleHint || new URL(args.canonicalUrl).pathname || args.canonicalUrl;
	const parts = [`# ${finalTitle}`, '', `Source: ${args.canonicalUrl}`, '', body];

	let wrapped = parts.join('\n');
	if (wrapped.length > 120_000) {
		wrapped = `${wrapped.slice(0, 120_000)}\n\n[Content truncated due to size]`;
	}

	return { title: finalTitle, markdown: wrapped };
};

const pageToMarkdown = (args: { pageUrl: string; html: string }) => {
	const $ = load(args.html);

	$('script, style, noscript, template, svg').remove();

	const title =
		normalizeWhitespace($('title').first().text()) ||
		normalizeWhitespace($('h1').first().text()) ||
		new URL(args.pageUrl).pathname ||
		args.pageUrl;

	const headings = $('h1, h2, h3')
		.map((_, element) => normalizeWhitespace($(element).text()))
		.get()
		.filter(Boolean)
		.slice(0, 100);

	const textBlocks = $('main p, article p, main li, article li, p, li')
		.map((_, element) => normalizeWhitespace($(element).text()))
		.get()
		.filter(Boolean)
		.filter((text, index, all) => all.indexOf(text) === index)
		.slice(0, 300);

	const fallback = normalizeWhitespace($('main').text() || $('article').text() || $('body').text())
		.split(/\.(?:\s+|$)/)
		.map((chunk) => normalizeWhitespace(chunk))
		.filter(Boolean)
		.map((chunk) => `${chunk}.`)
		.slice(0, 150);

	const contentLines = (textBlocks.length > 0 ? textBlocks : fallback).slice(0, 300);

	const lines = [
		`# ${title}`,
		'',
		`Source: ${args.pageUrl}`,
		'',
		headings.length > 0 ? '## Headings' : '',
		headings.length > 0 ? headings.map((heading) => `- ${heading}`).join('\n') : '',
		headings.length > 0 ? '' : '',
		'## Content',
		...contentLines
	].filter(Boolean);

	let markdown = lines.join('\n\n');
	if (markdown.length > 120_000) {
		markdown = `${markdown.slice(0, 120_000)}\n\n[Content truncated due to size]`;
	}

	return {
		title,
		headings,
		markdown
	};
};

const fetchWithRedirects = async (args: { url: string; init: RequestInit; quiet: boolean }) => {
	const result = await Result.tryPromise(async () => {
		let current = args.url;

		for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
			const response = await fetch(current, {
				...args.init,
				redirect: 'manual',
				signal: AbortSignal.timeout(15_000)
			});

			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get('location');
				if (!location) return { response, finalUrl: current };

				const next = new URL(location, current);
				const currentUrl = new URL(current);
				if (next.protocol !== 'http:' && next.protocol !== 'https:') return null;
				if (next.origin !== currentUrl.origin) return null;

				current = next.toString();
				continue;
			}

			return { response, finalUrl: current };
		}

		return null;
	});

	return result.match({
		ok: (value) => value,
		err: (error) => {
			if (!args.quiet) {
				Metrics.error('resource.website.redirects.error', {
					url: args.url,
					error: Metrics.errorInfo(error)
				});
			}
			return null;
		}
	});
};

const fetchPage = async (args: {
	canonicalUrl: string;
	quiet: boolean;
	mdSupportByOrigin: Map<string, MarkdownVariantSupport>;
}) => {
	const result = await Result.tryPromise(async () => {
		const canonicalParsed = new URL(args.canonicalUrl);
		const init: RequestInit = {
			headers: {
				'user-agent': BOT_USER_AGENT,
				accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1'
			}
		};

		const readTextSafe = async (response: Response) => {
			const contentLengthHeader = response.headers.get('content-length');
			if (contentLengthHeader) {
				const contentLength = Number.parseInt(contentLengthHeader, 10);
				if (Number.isFinite(contentLength) && contentLength > MAX_FETCH_BYTES) return null;
			}

			const text = await response.text();
			if (text.length > MAX_FETCH_BYTES) return null;
			return text;
		};

		const support =
			args.mdSupportByOrigin.get(canonicalParsed.origin) ??
			({ dotMd: null, slashDotMd: null } satisfies MarkdownVariantSupport);
		args.mdSupportByOrigin.set(canonicalParsed.origin, support);

		const tryMarkdownFetch = async (candidateUrl: string) => {
			const fetched = await fetchWithRedirects({ url: candidateUrl, init, quiet: args.quiet });
			if (!fetched) return null;
			if (!fetched.response.ok) return null;

			const contentType = (fetched.response.headers.get('content-type') ?? '').toLowerCase();
			const isText = !contentType || contentType.startsWith('text/');
			if (!isText) return null;

			const body = await readTextSafe(fetched.response);
			if (!body) return null;
			if (looksLikeHtml(body)) return null;

			const { title, markdown } = wrapMarkdownSnapshot({
				canonicalUrl: args.canonicalUrl,
				markdown: body,
				titleHint: canonicalParsed.pathname
			});
			const headings = extractMarkdownHeadings(body);
			const links = extractLinksFromMarkdown(body, args.canonicalUrl);

			return {
				title,
				headings,
				markdown,
				links,
				meta: { noindex: false, nofollow: false }
			};
		};

		const tryCanonicalFetch = async () => {
			const fetched = await fetchWithRedirects({ url: args.canonicalUrl, init, quiet: args.quiet });
			if (!fetched) return null;
			if (!fetched.response.ok) return null;

			const contentType = (fetched.response.headers.get('content-type') ?? '').toLowerCase();
			const isHtml =
				contentType.includes('text/html') ||
				contentType.includes('application/xhtml+xml') ||
				contentType.includes('application/xml');
			const isText = !contentType || contentType.startsWith('text/');
			if (!isHtml && !isText) return null;

			const body = await readTextSafe(fetched.response);
			if (!body) return null;

			const isMarkdownLike =
				contentType.includes('text/markdown') ||
				(isText &&
					isMarkdownVariantPath(new URL(fetched.finalUrl).pathname) &&
					!looksLikeHtml(body));
			if (isMarkdownLike) {
				const { title, markdown } = wrapMarkdownSnapshot({
					canonicalUrl: args.canonicalUrl,
					markdown: body,
					titleHint: canonicalParsed.pathname
				});
				const headings = extractMarkdownHeadings(body);
				const links = extractLinksFromMarkdown(body, args.canonicalUrl);
				return {
					title,
					headings,
					markdown,
					links,
					meta: { noindex: false, nofollow: false }
				};
			}

			if (!isHtml) {
				const normalizedText = normalizeWhitespace(body);
				if (!normalizedText) return null;
				return {
					title: canonicalParsed.pathname || args.canonicalUrl,
					headings: [] as string[],
					markdown: `# ${canonicalParsed.pathname || args.canonicalUrl}\n\nSource: ${args.canonicalUrl}\n\n## Content\n\n${normalizedText}`,
					links: [] as string[],
					meta: { noindex: false, nofollow: false }
				};
			}

			const meta = parseMetaRobots(body);
			const { title, headings, markdown } = pageToMarkdown({
				pageUrl: args.canonicalUrl,
				html: body
			});
			const links = extractLinks(body, args.canonicalUrl);
			return {
				title,
				headings,
				markdown,
				links,
				meta
			};
		};

		if (!isMarkdownVariantPath(canonicalParsed.pathname)) {
			const dotMdUrl = buildDotMdUrl(args.canonicalUrl);
			const slashDotMdUrl = buildSlashDotMdUrl(args.canonicalUrl);
			const candidates = Array.from(new Set([dotMdUrl, slashDotMdUrl]));

			const tryKnown = async () => {
				if (support.dotMd) return tryMarkdownFetch(dotMdUrl);
				if (support.slashDotMd) return tryMarkdownFetch(slashDotMdUrl);
				return null;
			};

			if (support.dotMd === false && support.slashDotMd === false) {
				return tryCanonicalFetch();
			}

			if (support.dotMd !== null || support.slashDotMd !== null) {
				const markdown = await tryKnown();
				return markdown ?? tryCanonicalFetch();
			}

			// Probe once per origin: `.md` first, then `/.md`.
			const dotAttempt = candidates[0] ? await tryMarkdownFetch(candidates[0]) : null;
			if (dotAttempt) {
				support.dotMd = true;
				support.slashDotMd = false;
				return dotAttempt;
			}
			support.dotMd = false;

			const slashCandidate = candidates.find((u) => u !== candidates[0]);
			const slashAttempt = slashCandidate ? await tryMarkdownFetch(slashCandidate) : null;
			if (slashAttempt) {
				support.slashDotMd = true;
				return slashAttempt;
			}
			support.slashDotMd = false;

			return tryCanonicalFetch();
		}

		return tryCanonicalFetch();
	});

	return result.match({
		ok: (page) => page,
		err: (error) => {
			if (!args.quiet) {
				Metrics.error('resource.website.page.error', {
					url: args.canonicalUrl,
					error: Metrics.errorInfo(error)
				});
			}
			return null;
		}
	});
};

const crawlWebsite = async (args: {
	startUrl: string;
	maxPages: number;
	maxDepth: number;
	quiet: boolean;
}): Promise<CrawlResult> => {
	const normalizedStart = normalizeUrl(args.startUrl);
	if (!normalizedStart) {
		throw new ResourceError({
			message: 'Failed to normalize website URL',
			hint: 'Provide a valid absolute HTTPS URL for website resources.'
		});
	}

	const start = new URL(normalizedStart);
	const scopePath = scopePathFromStartUrl(start);
	const robotsRules = await fetchRobotsRules(start.origin, args.quiet);
	const sitemapUrls = await fetchSitemapUrls(start, args.quiet);
	const mdSupportByOrigin = new Map<string, MarkdownVariantSupport>();

	const queue: CrawlQueueItem[] = [];
	const visited = new Set<string>();
	const pages: CrawledPage[] = [];

	const enqueue = (url: string, depth: number) => {
		if (visited.has(url)) return;
		if (depth > args.maxDepth) return;
		const parsed = new URL(url);
		if (!isInScope(parsed, start.origin, scopePath)) return;
		if (hasBinaryExtension(parsed)) return;
		if (!isPathAllowedByRobots(parsed.pathname, robotsRules)) return;
		visited.add(url);
		queue.push({ url, depth });
	};

	enqueue(normalizedStart, 0);
	for (const rawUrl of sitemapUrls) {
		const normalized = normalizeUrl(rawUrl, normalizedStart);
		if (!normalized) continue;
		enqueue(normalized, 1);
	}

	while (queue.length > 0 && pages.length < args.maxPages) {
		const current = queue.shift();
		if (!current) break;

		const page = await fetchPage({
			canonicalUrl: current.url,
			quiet: args.quiet,
			mdSupportByOrigin
		});
		if (!page) continue;

		if (!page.meta.nofollow && current.depth < args.maxDepth) {
			for (const link of page.links) {
				enqueue(link, current.depth + 1);
			}
		}

		if (page.meta.noindex) continue;

		pages.push({
			url: current.url,
			title: page.title,
			markdown: page.markdown,
			headings: page.headings,
			fetchedAt: new Date().toISOString()
		});
	}

	if (pages.length === 0) {
		throw new ResourceError({
			message: `No indexable pages found for ${args.startUrl}`,
			hint: 'The website may block crawling via robots.txt/meta tags, or no HTML pages were reachable from the provided URL.'
		});
	}

	return { pages, scopePath };
};

const sanitizeSegment = (segment: string) => {
	const cleaned = segment
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return cleaned || 'index';
};

const pageUrlToFilePath = (pageUrl: string) => {
	const parsed = new URL(pageUrl);
	const trimmed = parsed.pathname.replace(/\/+$/, '');
	if (trimmed.length === 0) return 'pages/index.md';

	const rawSegments = trimmed.split('/').filter(Boolean).map(sanitizeSegment);

	if (rawSegments.length === 0) return 'pages/index.md';

	const last = rawSegments[rawSegments.length - 1] ?? 'index';
	const normalizedLast = last.replace(/\.(?:html|htm)$/i, '') || 'index';
	rawSegments[rawSegments.length - 1] = normalizedLast;

	return `pages/${rawSegments.join('/')}.md`;
};

const buildSnapshot = async (args: {
	targetPath: string;
	startUrl: string;
	maxPages: number;
	maxDepth: number;
	quiet: boolean;
}) => {
	await fs.mkdir(path.join(args.targetPath, 'pages'), { recursive: true });

	const crawl = await crawlWebsite({
		startUrl: args.startUrl,
		maxPages: args.maxPages,
		maxDepth: args.maxDepth,
		quiet: args.quiet
	});

	const indexEntries: WebsiteManifestPage[] = [];

	for (const page of crawl.pages) {
		const filePath = pageUrlToFilePath(page.url);
		const absolutePath = path.join(args.targetPath, filePath);
		await fs.mkdir(path.dirname(absolutePath), { recursive: true });
		await Bun.write(absolutePath, page.markdown);
		indexEntries.push({
			url: page.url,
			title: page.title,
			filePath,
			fetchedAt: page.fetchedAt
		});
	}

	const indexContent = `${indexEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`;
	await Bun.write(path.join(args.targetPath, INDEX_FILE), indexContent);

	const manifest: WebsiteManifest = {
		version: 1,
		url: args.startUrl,
		scopePath: crawl.scopePath,
		crawledAt: new Date().toISOString(),
		maxPages: args.maxPages,
		maxDepth: args.maxDepth,
		pageCount: indexEntries.length,
		pages: indexEntries
	};

	await Bun.write(path.join(args.targetPath, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
	return manifest;
};

const ensureWebsiteResource = async (config: BtcaWebsiteResourceArgs) => {
	const urlValidation = validateWebsiteUrl(config.url);
	if (!urlValidation.success) {
		throw new ResourceError({
			message: urlValidation.error,
			hint: 'Website resources require a valid public HTTPS URL (no localhost/private IPs).'
		});
	}

	const resourceKey = resourceNameToKey(config.name);
	const localPath = path.join(config.resourcesDirectoryPath, resourceKey);
	const tempPath = `${localPath}.tmp-${crypto.randomUUID()}`;

	const ensureDir = await Result.tryPromise(() =>
		fs.mkdir(config.resourcesDirectoryPath, { recursive: true })
	);
	ensureDir.match({
		ok: () => undefined,
		err: (cause) => {
			throw new ResourceError({
				message: 'Failed to create resources directory',
				hint: 'Check that you have write permissions to the btca data directory.',
				cause
			});
		}
	});

	const existingManifest = await readManifest(localPath);
	const hasExistingSnapshot = await hasSnapshotFiles(localPath);
	if (
		existingManifest &&
		hasExistingSnapshot &&
		isManifestFresh(existingManifest, config.ttlHours)
	) {
		Metrics.info('resource.website.cache.hit', {
			name: config.name,
			url: config.url,
			pageCount: existingManifest.pageCount
		});
		return localPath;
	}

	const crawlResult = await Result.tryPromise(async () => {
		await fs.rm(tempPath, { recursive: true, force: true });
		await fs.mkdir(tempPath, { recursive: true });
		return buildSnapshot({
			targetPath: tempPath,
			startUrl: config.url,
			maxPages: config.maxPages,
			maxDepth: config.maxDepth,
			quiet: config.quiet
		});
	});

	return crawlResult.match({
		ok: async (manifestPromise) => {
			const manifest = await manifestPromise;
			await fs.rm(localPath, { recursive: true, force: true });
			await fs.rename(tempPath, localPath);
			Metrics.info('resource.website.crawled', {
				name: config.name,
				url: config.url,
				pageCount: manifest.pageCount,
				maxPages: config.maxPages,
				maxDepth: config.maxDepth
			});
			return localPath;
		},
		err: async (cause) => {
			await fs.rm(tempPath, { recursive: true, force: true });

			if (existingManifest && hasExistingSnapshot) {
				Metrics.error('resource.website.crawl_failed_fallback', {
					name: config.name,
					url: config.url,
					error: Metrics.errorInfo(cause)
				});
				return localPath;
			}

			throw new ResourceError({
				message: `Failed to crawl website resource "${config.name}"`,
				hint: `${CommonHints.CHECK_NETWORK} Verify the URL is reachable and allows crawling.`,
				cause
			});
		}
	});
};

export const loadWebsiteResource = async (
	config: BtcaWebsiteResourceArgs
): Promise<BtcaFsResource> => {
	const maxPages = Math.min(Math.max(config.maxPages, 1), LIMITS.WEBSITE_MAX_PAGES_MAX);
	const maxDepth = Math.min(Math.max(config.maxDepth, 0), LIMITS.WEBSITE_MAX_DEPTH_MAX);
	const ttlHours = Math.min(Math.max(config.ttlHours, 1), LIMITS.WEBSITE_TTL_HOURS_MAX);

	const localPath = await Metrics.span(
		'resource.website.ensure',
		() =>
			ensureWebsiteResource({
				...config,
				maxPages,
				maxDepth,
				ttlHours
			}),
		{ resource: config.name }
	);

	return {
		_tag: 'fs-based',
		name: config.name,
		fsName: resourceNameToKey(config.name),
		type: 'website',
		repoSubPaths: [],
		specialAgentInstructions: config.specialAgentInstructions,
		getAbsoluteDirectoryPath: async () => localPath
	};
};
