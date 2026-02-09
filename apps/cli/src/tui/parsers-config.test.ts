import { expect, test } from 'bun:test';

import { parsers } from './parsers-config.ts';

test('parsers-config urls are https with highlight queries', () => {
	for (const p of parsers) {
		expect(p.wasm.startsWith('https://')).toBeTrue();
		expect(p.queries.highlights.length).toBeGreaterThan(0);
		expect(p.queries.highlights.every((u) => u.startsWith('https://'))).toBeTrue();
		if (p.queries.injections) {
			expect(p.queries.injections.every((u) => u.startsWith('https://'))).toBeTrue();
		}
	}
});
