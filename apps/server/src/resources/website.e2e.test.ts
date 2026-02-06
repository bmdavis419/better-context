import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Collections } from '../collections/service.ts';
import { clearVirtualCollectionMetadata } from '../collections/virtual-metadata.ts';
import { Config } from '../config/index.ts';
import { Context } from '../context/index.ts';
import { startServer, type ServerInstance } from '../index.ts';
import { GlobTool } from '../tools/glob.ts';
import { GrepTool } from '../tools/grep.ts';
import { ListTool } from '../tools/list.ts';
import { ReadTool } from '../tools/read.ts';
import { VirtualFs } from '../vfs/virtual-fs.ts';

import { Resources } from './service.ts';

type MockRoute = {
	status?: number;
	headers?: Record<string, string>;
	body?: string;
};

type MockRoutes = Record<string, MockRoute>;

describe('Website Resource E2E', () => {
	let tempDir = '';
	let projectDir = '';
	let originalCwd = '';
	let originalHome: string | undefined;
	let originalFetch: typeof fetch;
	let server: ServerInstance | null = null;
	let lastVfsId: string | undefined;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'btca-website-e2e-'));
		projectDir = path.join(tempDir, 'project');
		await fs.mkdir(projectDir, { recursive: true });

		originalCwd = process.cwd();
		originalHome = process.env.HOME;
		originalFetch = globalThis.fetch;

		process.env.HOME = tempDir;
		process.chdir(projectDir);
	});

	afterEach(async () => {
		if (lastVfsId) {
			VirtualFs.dispose(lastVfsId);
			clearVirtualCollectionMetadata(lastVfsId);
			lastVfsId = undefined;
		}

		if (server) {
			server.stop();
			server = null;
		}

		globalThis.fetch = originalFetch;
		process.chdir(originalCwd);
		process.env.HOME = originalHome;
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	const installMockFetch = (routes: MockRoutes) => {
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			const url =
				typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

			if (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:')) {
				return originalFetch(input as Parameters<typeof fetch>[0], init);
			}

			const route = routes[url];
			if (!route) return new Response('not found', { status: 404 });
			return new Response(route.body ?? '', {
				status: route.status ?? 200,
				headers: route.headers
			});
		}) as typeof fetch;
	};

	it('adds website resource through API and reads crawled snapshot through tools', async () => {
		await Bun.write(
			path.join(projectDir, 'btca.config.jsonc'),
			JSON.stringify(
				{
					$schema: 'https://btca.dev/btca.schema.json',
					provider: 'opencode',
					model: 'claude-haiku-4-5',
					resources: []
				},
				null,
				2
			)
		);

		installMockFetch({
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

		server = await startServer({ port: 0, quiet: true });

		const addResponse = await fetch(`${server.url}/config/resources`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				type: 'website',
				name: 'docsSite',
				url: 'https://docs.example.com/docs',
				maxPages: 25,
				maxDepth: 4,
				ttlHours: 12,
				specialNotes: 'Integration test docs resource'
			})
		});
		expect(addResponse.status).toBe(201);

		const addJson = (await addResponse.json()) as {
			type: string;
			maxPages: number;
			maxDepth: number;
		};
		expect(addJson.type).toBe('website');
		expect(addJson.maxPages).toBe(25);
		expect(addJson.maxDepth).toBe(4);

		const listResponse = await fetch(`${server.url}/resources`);
		expect(listResponse.status).toBe(200);
		const listJson = (await listResponse.json()) as {
			resources: Array<{ name: string; type: string; url?: string; ttlHours?: number }>;
		};
		const website = listJson.resources.find((resource) => resource.name === 'docsSite');
		expect(website).toBeDefined();
		expect(website?.type).toBe('website');
		expect(website?.url).toBe('https://docs.example.com/docs');
		expect(website?.ttlHours).toBe(12);

		await Context.run({ requestId: crypto.randomUUID(), txDepth: 0 }, async () => {
			const config = await Config.load();
			const resources = Resources.create(config);
			const collections = Collections.create({ config, resources });
			const collection = await collections.load({ resourceNames: ['docsSite'], quiet: true });
			lastVfsId = collection.vfsId;

			const context = { basePath: collection.path, vfsId: collection.vfsId };
			const listToolResult = await ListTool.execute({ path: '.' }, context);
			expect(listToolResult.output).toContain('docsSite/');

			const globResult = await GlobTool.execute({ pattern: '**/*.md' }, context);
			expect(globResult.output).toContain('docsSite/pages/docs/getting-started.md');
			expect(globResult.output).not.toContain('docsSite/pages/docs/private.md');

			const grepResult = await GrepTool.execute({ pattern: 'Install and run' }, context);
			expect(grepResult.output).toContain('docsSite/pages/docs/getting-started.md');

			const readResult = await ReadTool.execute(
				{ path: 'docsSite/pages/docs/getting-started.md' },
				context
			);
			expect(readResult.output).toContain('Source: https://docs.example.com/docs/getting-started');
		});
	});
});
