import { describe, expect, test } from 'bun:test';

import { getVisibleRangeStart, normalizeResumeThreadLabel } from './resume-thread-modal.lib.ts';

describe('resume-thread-modal helpers', () => {
	test('normalizes title whitespace to keep rows single-line', () => {
		expect(normalizeResumeThreadLabel('  hello\n\nworld\tthere  ')).toBe('hello world there');
		expect(normalizeResumeThreadLabel('')).toBe('Untitled thread');
		expect(normalizeResumeThreadLabel()).toBe('Untitled thread');
	});

	test('centers visible range around selection when possible', () => {
		expect(getVisibleRangeStart({ selectedIndex: 5, maxVisibleItems: 5, totalItems: 20 })).toBe(3);
	});

	test('clamps visible range near start and end', () => {
		expect(getVisibleRangeStart({ selectedIndex: 0, maxVisibleItems: 5, totalItems: 20 })).toBe(0);
		expect(getVisibleRangeStart({ selectedIndex: 19, maxVisibleItems: 5, totalItems: 20 })).toBe(
			15
		);
	});

	test('handles small lists without negative ranges', () => {
		expect(getVisibleRangeStart({ selectedIndex: 2, maxVisibleItems: 10, totalItems: 3 })).toBe(0);
		expect(getVisibleRangeStart({ selectedIndex: 0, maxVisibleItems: 0, totalItems: 3 })).toBe(0);
	});
});
