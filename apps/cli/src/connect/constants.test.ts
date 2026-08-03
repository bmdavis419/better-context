import { describe, expect, test } from 'bun:test';

import {
	CURATED_MODELS,
	PROVIDER_INFO,
	PROVIDER_MODEL_DOCS,
	PROVIDER_SETUP_LINKS
} from './constants.ts';

describe('Atlas Cloud connect metadata', () => {
	test('provides authenticated setup and a default model', () => {
		expect(PROVIDER_INFO.atlascloud).toEqual({ label: 'Atlas Cloud', requiresAuth: true });
		expect(CURATED_MODELS.atlascloud).toContainEqual({
			id: 'deepseek-ai/deepseek-v4-pro',
			label: 'DeepSeek V4 Pro'
		});
		expect(PROVIDER_SETUP_LINKS.atlascloud?.url).toBe('https://www.atlascloud.ai/console/api-keys');
		expect(PROVIDER_MODEL_DOCS.atlascloud?.url).toBe('https://api.atlascloud.ai/api/v1/models');
	});
});
