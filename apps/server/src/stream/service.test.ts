import { describe, it, expect } from 'bun:test';

import { createSseStream } from './service.ts';
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

describe('createSseStream', () => {
	it('streams reasoning deltas and includes final reasoning in done', async () => {
		const eventStream = (async function* () {
			yield { type: 'reasoning-delta', text: 'First ' } as const;
			yield { type: 'reasoning-delta', text: 'Second' } as const;
			yield { type: 'text-delta', text: 'Answer' } as const;
			yield { type: 'finish', finishReason: 'stop' } as const;
		})();

		const stream = createSseStream({
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

	it('includes usage, timing, throughput, and pricing on done when available', async () => {
		const eventStream = (async function* () {
			yield { type: 'text-delta', text: 'Answer' } as const;
			await new Promise<void>((resolve) => setTimeout(resolve, 10));
			yield {
				type: 'finish',
				finishReason: 'stop',
				usage: {
					inputTokens: 750_000,
					outputTokens: 2_000_000,
					reasoningTokens: 250_000,
					cachedTokens: 250_000,
					cacheReadTokens: 200_000,
					cacheWriteTokens: 50_000,
					totalTokens: 3_250_000
				}
			} as const;
		})();

		const stream = createSseStream({
			meta: {
				type: 'meta',
				model: { provider: 'openrouter', model: 'openai/gpt-4o-mini' },
				resources: ['svelte'],
				collection: { key: 'test', path: '/tmp' }
			},
			eventStream,
			requestStartMs: performance.now() - 50,
			pricing: {
				lookup: async () => ({
					source: 'models.dev' as const,
					modelKey: 'openai/gpt-4o-mini',
					ratesUsdPerMTokens: {
						input: 1,
						output: 2,
						reasoning: 0.5,
						cacheRead: 0.25,
						cacheWrite: 1.5
					}
				})
			}
		});

		const payload = await readStream(stream);
		const events = parseSseEvents(payload);

		const doneEvent = events.find((event) => event.type === 'done');
		expect(doneEvent && doneEvent.type).toBe('done');

		if (doneEvent?.type !== 'done') throw new Error('missing done event');

		expect(doneEvent.usage?.inputTokens).toBe(750_000);
		expect(doneEvent.usage?.outputTokens).toBe(2_000_000);
		expect(doneEvent.usage?.reasoningTokens).toBe(250_000);
		expect(doneEvent.usage?.cachedTokens).toBe(250_000);
		expect(doneEvent.usage?.cacheReadTokens).toBe(200_000);
		expect(doneEvent.usage?.cacheWriteTokens).toBe(50_000);
		expect(doneEvent.usage?.totalTokens).toBe(3_250_000);

		expect(typeof doneEvent.metrics?.timing?.totalMs).toBe('number');
		expect(typeof doneEvent.metrics?.timing?.genMs).toBe('number');
		expect((doneEvent.metrics?.timing?.genMs ?? 0) > 0).toBe(true);

		expect(typeof doneEvent.metrics?.throughput?.outputTokensPerSecond).toBe('number');
		expect(typeof doneEvent.metrics?.throughput?.totalTokensPerSecond).toBe('number');

		expect(doneEvent.metrics?.pricing?.source).toBe('models.dev');
		expect(doneEvent.metrics?.pricing?.modelKey).toBe('openai/gpt-4o-mini');
		expect(doneEvent.metrics?.pricing?.ratesUsdPerMTokens?.input).toBe(1);

		// cost = (0.75 * 1) + (2.0 * 2) + (0.25 * 0.5) + (0.2 * 0.25) + (0.05 * 1.5) = 5
		expect(doneEvent.metrics?.pricing?.costUsd?.total).toBeCloseTo(5, 8);
	});

	it('does not throw if the client cancels before an error is emitted', async () => {
		const eventStream = (async function* () {
			await new Promise<void>((resolve) => setTimeout(resolve, 5));
			yield { type: 'error', error: new Error('boom') } as const;
			yield { type: 'finish', finishReason: 'stop' } as const;
		})();

		const stream = createSseStream({
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
