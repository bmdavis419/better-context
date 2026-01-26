import { test, expect } from 'bun:test';

import { StreamService } from './service.ts';
import type { BtcaStreamEvent, BtcaStreamMetaEvent } from './types.ts';

const collectSseEvents = async (stream: ReadableStream<Uint8Array>): Promise<BtcaStreamEvent[]> => {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
		}
	} finally {
		reader.releaseLock();
	}

	const events: BtcaStreamEvent[] = [];
	const chunks = buffer.split('\n\n').filter((chunk) => chunk.trim().length > 0);
	for (const chunk of chunks) {
		const lines = chunk.split('\n');
		const dataLine = lines.find((line) => line.startsWith('data: '));
		if (!dataLine) continue;
		const raw = dataLine.slice(6);
		const parsed = JSON.parse(raw) as BtcaStreamEvent;
		events.push(parsed);
	}

	return events;
};

test('StreamService emits meta and done with question stripped', async () => {
	const meta: BtcaStreamMetaEvent = {
		type: 'meta',
		model: { provider: 'opencode', model: 'test-model' },
		resources: ['alpha'],
		collection: { key: 'alpha', path: '/tmp/alpha' }
	};

	const eventStream = (async function* () {
		yield { type: 'text-delta', text: 'What is Alpha?\n\n' } as const;
		yield { type: 'text-delta', text: 'Alpha is a test resource.' } as const;
		yield { type: 'finish', finishReason: 'stop' } as const;
	})();

	const stream = StreamService.createSseStream({
		meta,
		eventStream,
		question: 'What is Alpha?'
	});

	const events = await collectSseEvents(stream);
	expect(events.length).toBeGreaterThan(0);

	const [first] = events;
	expect(first?.type).toBe('meta');

	const done = events.find((event) => event.type === 'done');
	expect(done?.type).toBe('done');
	if (done && done.type === 'done') {
		expect(done.text.startsWith('What is Alpha?')).toBe(false);
		expect(done.text.includes('Alpha is a test resource.')).toBe(true);
	}
});
