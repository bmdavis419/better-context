import { describe, expect, it } from 'bun:test';

import { ResourceDefinitionSchema, WebsiteResourceSchema } from './schema.ts';

describe('Resource schema', () => {
	it('accepts valid website resources and applies defaults', () => {
		const result = ResourceDefinitionSchema.safeParse({
			type: 'website',
			name: 'public-docs',
			url: 'https://docs.example.com/docs'
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		if (result.data.type !== 'website') return;
		expect(result.data.maxPages).toBe(200);
		expect(result.data.maxDepth).toBe(3);
		expect(result.data.ttlHours).toBe(24);
	});

	it('rejects non-HTTPS website urls', () => {
		const result = WebsiteResourceSchema.safeParse({
			type: 'website',
			name: 'public-docs',
			url: 'http://docs.example.com/docs'
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.issues[0]?.message).toContain('HTTPS');
	});

	it('rejects private/local website urls', () => {
		const result = WebsiteResourceSchema.safeParse({
			type: 'website',
			name: 'public-docs',
			url: 'https://localhost/docs'
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.issues[0]?.message).toContain('localhost or private IP');
	});

	it('enforces bounds for maxPages/maxDepth/ttlHours', () => {
		const result = WebsiteResourceSchema.safeParse({
			type: 'website',
			name: 'public-docs',
			url: 'https://docs.example.com/docs',
			maxPages: 0,
			maxDepth: -1,
			ttlHours: 0
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.issues.length).toBeGreaterThanOrEqual(1);
	});
});
