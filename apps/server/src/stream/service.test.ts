import { describe, it, expect } from 'bun:test';

import { StreamService } from './service.ts';
import type { BtcaStreamEvent } from './types.ts';

const readStream = async (stream: ReadableStream<Uint8Array>) => {
	const decoder = new TextDecoder();
	let output = '';
	for await (const chunk of stream) {
		output += decoder.decode(chunk, { stream: true });
	}
	output += decoder.decode();
	return output;
};

const parseSseEvents = (payload: string) =>
	payload
		.split('\n\n')
		.map((chunk) => chunk.trim())
		.filter(Boolean)
		.map((chunk) => chunk.split('\n').find((line) => line.startsWith('data: ')))
		.filter((line): line is string => Boolean(line))
		.map((line) => JSON.parse(line.slice(6)) as BtcaStreamEvent);

describe('StreamService.createSseStream', () => {
	it('streams reasoning deltas and includes final reasoning in done', async () => {
		const eventStream = (async function* () {
			yield { type: 'reasoning-delta', text: 'First ' } as const;
			yield { type: 'reasoning-delta', text: 'Second' } as const;
			yield { type: 'text-delta', text: 'Answer' } as const;
			yield { type: 'finish', finishReason: 'stop' } as const;
		})();

		const stream = StreamService.createSseStream({
			meta: {
				type: 'meta',
				model: { provider: 'test', model: 'test-model' },
				resources: ['svelte'],
				collection: { key: 'test', path: '/tmp' }
			},
			eventStream,
			question: 'What?'
		});

		const payload = await readStream(stream);
		const events = parseSseEvents(payload);

		const reasoningDeltaText = events
			.filter((event) => event.type === 'reasoning.delta')
			.map((event) => event.delta)
			.join('');
		expect(reasoningDeltaText).toBe('First Second');

		const doneEvent = events.find((event) => event.type === 'done');
		expect(doneEvent?.reasoning).toBe('First Second');
	});

	it('does not throw if the client cancels before an error is emitted', async () => {
		const eventStream = (async function* () {
			await new Promise<void>((resolve) => setTimeout(resolve, 5));
			yield { type: 'error', error: new Error('boom') } as const;
			yield { type: 'finish', finishReason: 'stop' } as const;
		})();

		const stream = StreamService.createSseStream({
			meta: {
				type: 'meta',
				model: { provider: 'test', model: 'test-model' },
				resources: ['svelte'],
				collection: { key: 'test', path: '/tmp' }
			},
			eventStream
		});

		const reader = stream.getReader();
		await reader.read(); // meta
		await reader.cancel();

		// Let the async event loop run; the test will fail if it triggers an unhandled throw/rejection.
		await new Promise<void>((resolve) => setTimeout(resolve, 25));

		expect(true).toBe(true);
	});
});
