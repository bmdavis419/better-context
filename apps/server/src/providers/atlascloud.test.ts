import { afterEach, describe, expect, test } from 'bun:test';

import { getAuthStatus, getProviderAuthHint } from './auth.ts';
import { ATLAS_CLOUD_BASE_URL, createAtlasCloud } from './atlascloud.ts';
import { getProviderFactory, isProviderSupported } from './registry.ts';

describe('Atlas Cloud provider', () => {
	afterEach(() => {
		delete process.env.ATLASCLOUD_API_KEY;
	});

	test('registers an OpenAI-compatible chat model', () => {
		const factory = getProviderFactory('atlascloud');
		expect(isProviderSupported('atlascloud')).toBe(true);
		expect(factory).toBeDefined();

		const model = createAtlasCloud({ apiKey: 'test-key' })('deepseek-ai/deepseek-v4-pro');
		expect(model.provider).toBe('atlascloud.chat');
		expect(model.modelId).toBe('deepseek-ai/deepseek-v4-pro');
		expect(ATLAS_CLOUD_BASE_URL).toBe('https://api.atlascloud.ai/v1');
	});

	test('reads ATLASCLOUD_API_KEY for authentication', async () => {
		process.env.ATLASCLOUD_API_KEY = 'test-atlas-key';

		expect(await getAuthStatus('atlascloud')).toEqual({
			status: 'ok',
			authType: 'api',
			apiKey: 'test-atlas-key'
		});
		expect(getProviderAuthHint('atlascloud')).toContain('ATLASCLOUD_API_KEY');
	});
});
