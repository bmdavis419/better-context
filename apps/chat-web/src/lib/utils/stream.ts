import { BtcaStreamEventSchema, type BtcaStreamEvent } from '../types/index.ts';

/**
 * Parse a Server-Sent Events stream from a Response
 */
export async function* parseSSEStream(response: Response): AsyncGenerator<BtcaStreamEvent> {
	if (!response.body) {
		throw new Error('Response body is null');
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			// Process complete events from buffer
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			let eventData = '';

			for (const line of lines) {
				if (line.startsWith('data: ')) {
					eventData = line.slice(6);
				} else if (line === '' && eventData) {
					try {
						const parsed = JSON.parse(eventData) as unknown;
						const validated = BtcaStreamEventSchema.parse(parsed);
						yield validated;
					} catch (error) {
						console.error('Failed to parse SSE event:', error);
					}
					eventData = '';
				}
			}
		}

		// Process any remaining data
		if (buffer.trim()) {
			const lines = buffer.split('\n');
			let eventData = '';

			for (const line of lines) {
				if (line.startsWith('data: ')) {
					eventData = line.slice(6);
				}
			}

			if (eventData) {
				try {
					const parsed = JSON.parse(eventData) as unknown;
					const validated = BtcaStreamEventSchema.parse(parsed);
					yield validated;
				} catch {
					// Ignore incomplete final event
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
}
