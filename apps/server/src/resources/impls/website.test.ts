import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GlobTool } from '../../tools/glob.ts';
import { GrepTool } from '../../tools/grep.ts';
import { ListTool } from '../../tools/list.ts';
import { ReadTool } from '../../tools/read.ts';
import { VirtualFs } from '../../vfs/virtual-fs.ts';
import { loadWebsiteResource } from './website.ts';

const FIXTURE_URL = 'https://docs.example.com/docs';

type MockResponseInit = {
	status?: number;
	headers?: Record<string, string>;
	body?: string;
};

type MockRoutes = Record<string, MockResponseInit | (() => MockResponseInit)>;

describe('Website Resource', () => {
	let tempDir = '';
	let originalFetch: typeof fetch;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'btca-website-test-'));
		originalFetch = globalThis.fetch;
	});

	afterEach(async () => {
		globalThis.fetch = originalFetch;
		VirtualFs.disposeAll();
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	const withMockFetch = (routes: MockRoutes, fallback?: () => never) => {
		const calls: string[] = [];
		globalThis.fetch = (async (input: string | URL | Request) => {
			const url =
				typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
			calls.push(url);
			const route = routes[url];
			if (!route) {
				if (fallback) fallback();
				return new Response('not found', { status: 404 });
			}
			const response = typeof route === 'function' ? route() : route;
			return new Response(response.body ?? '', {
				status: response.status ?? 200,
				headers: response.headers
			});
		}) as typeof fetch;
		return calls;
	};

	const baseArgs = () => ({
		type: 'website' as const,
		name: 'docs-site',
		url: FIXTURE_URL,
		maxPages: 10,
		maxDepth: 3,
		ttlHours: 24,
		resourcesDirectoryPath: tempDir,
		specialAgentInstructions: '',
		quiet: true
	});

	it('rejects non-HTTPS website URLs', async () => {
		expect(
			loadWebsiteResource({
				...baseArgs(),
				url: 'http://docs.example.com/docs'
			})
		).rejects.toThrow();
	});

	it('crawls website pages, respects robots, and supports tools over snapshot files', async () => {
		withMockFetch({
			'https://docs.example.com/robots.txt': {
				body: 'User-agent: *\nDisallow: /docs/private\n'
			},
			'https://docs.example.com/sitemap.xml': {
				headers: { 'content-type': 'application/xml' },
				body: `<?xml version="1.0"?><urlset>
					<url><loc>https://docs.example.com/docs/getting-started</loc></url>
					<url><loc>https://docs.example.com/docs/private</loc></url>
				</urlset>`
			},
			'https://docs.example.com/docs': {
				headers: { 'content-type': 'text/html' },
				body: `
					<html><head><title>Docs Home</title></head><body>
						<main>
							<h1>Docs Home</h1>
							<p>Welcome to docs.</p>
							<a href="/docs/getting-started">Start</a>
							<a href="/docs/private">Private</a>
						</main>
					</body></html>
				`
			},
			'https://docs.example.com/docs/getting-started': {
				headers: { 'content-type': 'text/html' },
				body: `
					<html><head><title>Getting Started</title></head><body>
						<article>
							<h1>Getting Started</h1>
							<p>Install and run.</p>
						</article>
					</body></html>
				`
			},
			'https://docs.example.com/docs/private': {
				headers: { 'content-type': 'text/html' },
				body: '<html><head><title>Private</title></head><body><p>blocked</p></body></html>'
			}
		});

		const resource = await loadWebsiteResource(baseArgs());
		const resourcePath = await resource.getAbsoluteDirectoryPath();

		expect(await Bun.file(path.join(resourcePath, 'pages/docs.md')).exists()).toBe(true);
		expect(await Bun.file(path.join(resourcePath, 'pages/docs/getting-started.md')).exists()).toBe(
			true
		);
		expect(await Bun.file(path.join(resourcePath, 'pages/docs/private.md')).exists()).toBe(false);

		const indexLines = (await Bun.file(path.join(resourcePath, '_index.jsonl')).text())
			.split('\n')
			.filter(Boolean);
		expect(indexLines.length).toBe(2);

		const vfsId = VirtualFs.create();
		await VirtualFs.mkdir('/', { recursive: true }, vfsId);
		await VirtualFs.importDirectoryFromDisk({
			sourcePath: resourcePath,
			destinationPath: '/docs-site',
			vfsId
		});

		const context = { basePath: '/', vfsId };
		const listResult = await ListTool.execute({ path: '.' }, context);
		expect(listResult.output).toContain('docs-site');

		const globResult = await GlobTool.execute({ pattern: '**/*.md' }, context);
		expect(globResult.output).toContain('docs-site/pages/docs/getting-started.md');

		const grepResult = await GrepTool.execute({ pattern: 'Getting Started' }, context);
		expect(grepResult.output).toContain('docs-site/pages/docs/getting-started.md');

		const readResult = await ReadTool.execute({ path: 'docs-site/pages/docs.md' }, context);
		expect(readResult.output).toContain('Source: https://docs.example.com/docs');

		VirtualFs.dispose(vfsId);
	});

	it('uses cached snapshot when still fresh', async () => {
		const initialCalls = withMockFetch({
			'https://docs.example.com/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
			'https://docs.example.com/sitemap.xml': {
				headers: { 'content-type': 'application/xml' },
				body: '<?xml version="1.0"?><urlset></urlset>'
			},
			'https://docs.example.com/docs': {
				headers: { 'content-type': 'text/html' },
				body: '<html><head><title>Docs</title></head><body><main><p>cached</p></main></body></html>'
			}
		});

		const resource = await loadWebsiteResource(baseArgs());
		const resourcePath = await resource.getAbsoluteDirectoryPath();
		expect(initialCalls.length).toBeGreaterThan(0);

		const cachedCalls = withMockFetch({}, () => {
			throw new Error('fetch should not be called for fresh cache');
		});
		const cached = await loadWebsiteResource(baseArgs());
		expect(await cached.getAbsoluteDirectoryPath()).toBe(resourcePath);
		expect(cachedCalls.length).toBe(0);
	});

	it('falls back to stale cache when re-crawl fails', async () => {
		withMockFetch({
			'https://docs.example.com/robots.txt': { body: 'User-agent: *\nAllow: /\n' },
			'https://docs.example.com/sitemap.xml': {
				headers: { 'content-type': 'application/xml' },
				body: '<?xml version="1.0"?><urlset></urlset>'
			},
			'https://docs.example.com/docs': {
				headers: { 'content-type': 'text/html' },
				body: '<html><head><title>Docs</title></head><body><main><p>cached</p></main></body></html>'
			}
		});

		const seeded = await loadWebsiteResource({ ...baseArgs(), ttlHours: 1 });
		const resourcePath = await seeded.getAbsoluteDirectoryPath();
		const manifestPath = path.join(resourcePath, '.btca-website-manifest.json');
		const manifest = JSON.parse(await Bun.file(manifestPath).text()) as { crawledAt: string };
		manifest.crawledAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
		await Bun.write(manifestPath, JSON.stringify(manifest));

		withMockFetch({
			'https://docs.example.com/robots.txt': () => {
				throw new Error('network failure');
			}
		});

		const fallback = await loadWebsiteResource({ ...baseArgs(), ttlHours: 1 });
		expect(await fallback.getAbsoluteDirectoryPath()).toBe(resourcePath);
		expect(await Bun.file(path.join(resourcePath, 'pages/docs.md')).exists()).toBe(true);
	});
});
