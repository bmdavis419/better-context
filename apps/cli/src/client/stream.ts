import { Result } from 'better-result';
import { BtcaStreamEventSchema, type BtcaStreamEvent } from 'btca-server/stream/types';

/**
 * Parse a Server-Sent Events stream from a Response
 */
export async function* parseSSEStream(response: Response): AsyncGenerator<BtcaStreamEvent> {
	if (!response.body) {
		throw new Error('Response body is null');
	}

	const decoder = new TextDecoder();
	let buffer = '';

	for await (const value of response.body) {
		buffer += decoder.decode(value, { stream: true });

		// Process complete events from buffer
		const lines = buffer.split('\n');
		buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

		let eventType = '';
		let eventData = '';

		for (const line of lines) {
			if (line.startsWith('event: ')) {
				eventType = line.slice(7);
			} else if (line.startsWith('data: ')) {
				eventData = line.slice(6);
			} else if (line === '' && eventData) {
				// Empty line = end of event
				const parsed = Result.try(() => JSON.parse(eventData));
				const validated = parsed.andThen((value) =>
					Result.try(() => BtcaStreamEventSchema.parse(value))
				);
				if (Result.isOk(validated)) {
					yield validated.value;
				} else {
					console.error('Failed to parse SSE event:', validated.error);
				}
				eventType = '';
				eventData = '';
			}
		}
	}

	// Process any remaining data in buffer
	if (buffer.trim()) {
		const lines = buffer.split('\n');
		let eventData = '';

		for (const line of lines) {
			if (line.startsWith('data: ')) {
				eventData = line.slice(6);
			}
		}

		if (eventData) {
			const parsed = Result.try(() => JSON.parse(eventData));
			const validated = parsed.andThen((value) =>
				Result.try(() => BtcaStreamEventSchema.parse(value))
			);
			if (Result.isOk(validated)) {
				yield validated.value;
			}
		}
	}
}
