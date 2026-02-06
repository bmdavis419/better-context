import { createBrowserbaseRendererFromEnv } from './index.ts';

const main = async () => {
	const renderer = createBrowserbaseRendererFromEnv();
	if (!renderer) {
		throw new Error('BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are required');
	}

	try {
		const { html, finalUrl } = await renderer.render('https://docs.btca.dev/guides/quickstart');
		console.log(finalUrl);
		console.log(html.slice(0, 2_000));
	} finally {
		await renderer.close();
	}
};

await main();
