import { describe, expect, test } from 'bun:test';

import { getOsc52Sequence, tryOsc52Copy } from './clipboard.ts';

describe('clipboard OSC52 fallback', () => {
	test('builds a valid OSC52 sequence', () => {
		expect(getOsc52Sequence('hello')).toBe('\u001b]52;c;aGVsbG8=\u0007');
	});

	test('does not copy when stdout is not TTY', () => {
		const writes: string[] = [];
		const ok = tryOsc52Copy('hello', {
			isTTY: false,
			term: 'xterm-256color',
			write: (value) => writes.push(value)
		});
		expect(ok).toBe(false);
		expect(writes).toHaveLength(0);
	});

	test('does not copy on dumb terminal', () => {
		const writes: string[] = [];
		const ok = tryOsc52Copy('hello', {
			isTTY: true,
			term: 'dumb',
			write: (value) => writes.push(value)
		});
		expect(ok).toBe(false);
		expect(writes).toHaveLength(0);
	});

	test('writes OSC52 sequence on compatible terminal', () => {
		const writes: string[] = [];
		const ok = tryOsc52Copy('hello', {
			isTTY: true,
			term: 'xterm-256color',
			write: (value) => writes.push(value)
		});
		expect(ok).toBe(true);
		expect(writes).toEqual(['\u001b]52;c;aGVsbG8=\u0007']);
	});
});
