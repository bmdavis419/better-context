import Browserbase from '@browserbasehq/sdk';
import { connect, type Browser, type Page } from 'puppeteer-core';

export type BbRenderer = {
	render: (url: string) => Promise<{ html: string; finalUrl: string }>;
	close: () => Promise<void>;
};

export type BbEnv = {
	apiKey: string;
	projectId: string;
};

export const getBrowserbaseEnv = () => {
	const apiKey = Bun.env.BROWSERBASE_API_KEY;
	const projectId = Bun.env.BROWSERBASE_PROJECT_ID;
	if (!apiKey || !projectId) return null;
	return { apiKey, projectId };
};

export const createBrowserbaseRenderer = (env: BbEnv): BbRenderer => {
	const bb = new Browserbase({ apiKey: env.apiKey });

	let browser: Browser | null = null;
	let page: Page | null = null;
	let initPromise: Promise<void> | null = null;

	// Serialize renders; a single page/browser instance isn't safe for concurrent `goto`s.
	let queue = Promise.resolve();
	const runExclusive = <T>(fn: () => Promise<T>) => {
		const next = queue.then(fn, fn);
		queue = next.then(
			() => undefined,
			() => undefined
		);
		return next;
	};

	const ensureInit = async () => {
		if (page && browser) return;
		if (initPromise) return initPromise;

		initPromise = (async () => {
			const session = await bb.sessions.create({ projectId: env.projectId });
			const nextBrowser = await connect({ browserWSEndpoint: session.connectUrl });
			const existingPages = await nextBrowser.pages();
			const nextPage = existingPages[0] ?? (await nextBrowser.newPage());

			await nextPage.setRequestInterception(true);
			nextPage.on('request', (req) => {
				const type = req.resourceType();
				if (type === 'image' || type === 'font' || type === 'media') {
					void req.abort();
					return;
				}
				void req.continue();
			});

			browser = nextBrowser;
			page = nextPage;
		})().finally(() => {
			initPromise = null;
		});

		return initPromise;
	};

	const render = (url: string) =>
		runExclusive(async () => {
			await ensureInit();
			if (!page) throw new Error('Browserbase renderer failed to initialize a page');

			await page.goto(url, { waitUntil: 'networkidle2', timeout: 15_000 });
			const html = await page.content();
			return { html, finalUrl: page.url() };
		});

	const close = async () => {
		const current = browser;
		browser = null;
		page = null;
		initPromise = null;

		await current?.close().catch(() => undefined);
	};

	return { render, close };
};

export const createBrowserbaseRendererFromEnv = () => {
	const env = getBrowserbaseEnv();
	return env ? createBrowserbaseRenderer(env) : null;
};
