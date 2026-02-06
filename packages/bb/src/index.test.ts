import { describe, expect, it } from 'bun:test';

import { getBrowserbaseEnv } from './index.ts';

describe('getBrowserbaseEnv', () => {
	it('returns null when missing env vars', () => {
		const originalKey = Bun.env.BROWSERBASE_API_KEY;
		const originalProject = Bun.env.BROWSERBASE_PROJECT_ID;

		try {
			delete Bun.env.BROWSERBASE_API_KEY;
			delete Bun.env.BROWSERBASE_PROJECT_ID;
			expect(getBrowserbaseEnv()).toBeNull();
		} finally {
			if (originalKey) Bun.env.BROWSERBASE_API_KEY = originalKey;
			else delete Bun.env.BROWSERBASE_API_KEY;
			if (originalProject) Bun.env.BROWSERBASE_PROJECT_ID = originalProject;
			else delete Bun.env.BROWSERBASE_PROJECT_ID;
		}
	});

	it('returns env when present', () => {
		const originalKey = Bun.env.BROWSERBASE_API_KEY;
		const originalProject = Bun.env.BROWSERBASE_PROJECT_ID;

		try {
			Bun.env.BROWSERBASE_API_KEY = 'key';
			Bun.env.BROWSERBASE_PROJECT_ID = 'project';
			expect(getBrowserbaseEnv()).toEqual({ apiKey: 'key', projectId: 'project' });
		} finally {
			if (originalKey) Bun.env.BROWSERBASE_API_KEY = originalKey;
			else delete Bun.env.BROWSERBASE_API_KEY;
			if (originalProject) Bun.env.BROWSERBASE_PROJECT_ID = originalProject;
			else delete Bun.env.BROWSERBASE_PROJECT_ID;
		}
	});
});
