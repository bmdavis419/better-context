import type { OcEvent } from '../agent/types.ts';
import { getErrorMessage, getErrorTag } from '../errors.ts';
import { Metrics } from '../metrics/index.ts';
import {
	StreamingTagStripper,
	extractCoreQuestion,
	stripUserQuestionFromStart
} from '@btca/shared';

import type {
	BtcaStreamDoneEvent,
	BtcaStreamErrorEvent,
	BtcaStreamEvent,
	BtcaStreamMetaEvent,
	BtcaStreamReasoningDeltaEvent,
	BtcaStreamTextDeltaEvent,
	BtcaStreamToolUpdatedEvent
} from './types.ts';

type Accumulator = {
	partIds: string[];
	partText: Map<string, string>;
	combined: string;
};

const makeAccumulator = (): Accumulator => ({ partIds: [], partText: new Map(), combined: '' });

const updateAccumulator = (acc: Accumulator, partId: string, nextText: string): string => {
	if (!acc.partIds.includes(partId)) acc.partIds.push(partId);
	acc.partText.set(partId, nextText);

	const nextCombined = acc.partIds.map((id) => acc.partText.get(id) ?? '').join('');
	const delta = nextCombined.startsWith(acc.combined)
		? nextCombined.slice(acc.combined.length)
		: nextCombined;
	acc.combined = nextCombined;
	return delta;
};

const toSse = (event: BtcaStreamEvent): string => {
	// Standard SSE: an event name + JSON payload.
	return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
};

export namespace StreamService {
	export const createSseStream = (args: {
		meta: BtcaStreamMetaEvent;
		eventStream: AsyncIterable<OcEvent>;
		question?: string; // Original question - used to filter echoed user message
	}): ReadableStream<Uint8Array> => {
		const encoder = new TextEncoder();

		const text = makeAccumulator();
		const reasoning = makeAccumulator();
		const toolsByCallId = new Map<string, Omit<BtcaStreamToolUpdatedEvent, 'type'>>();

		let toolUpdates = 0;
		let textEvents = 0;
		let reasoningEvents = 0;

		// Create streaming tag stripper for filtering history markers
		const tagStripper = new StreamingTagStripper();

		// Extract the core question for stripping echoed user message from final response
		const coreQuestion = extractCoreQuestion(args.question);

		// Track total emitted text for accurate final text reconstruction
		let emittedText = '';

		const emit = (
			controller: ReadableStreamDefaultController<Uint8Array>,
			event: BtcaStreamEvent
		) => {
			controller.enqueue(encoder.encode(toSse(event)));
		};

		return new ReadableStream<Uint8Array>({
			start(controller) {
				Metrics.info('stream.start', {
					collectionKey: args.meta.collection.key,
					resources: args.meta.resources,
					model: args.meta.model
				});

				emit(controller, args.meta);

				(async () => {
					try {
						for await (const event of args.eventStream) {
							if (event.type === 'message.part.updated') {
								const props = event.properties as any;
								const part: any = props?.part;
								if (!part || typeof part !== 'object') continue;

								// Skip user messages - only stream assistant responses
								const messageRole = props?.message?.role ?? props?.role;
								if (messageRole === 'user') {
									continue;
								}

								if (part.type === 'text') {
									const partId = String(part.id);
									const nextText = String(part.text ?? '');

									// Get the raw delta from accumulator
									const rawDelta = updateAccumulator(text, partId, nextText);

									if (rawDelta.length > 0) {
										// Filter through the streaming tag stripper
										const cleanDelta = tagStripper.process(rawDelta);

										if (cleanDelta.length > 0) {
											textEvents += 1;
											emittedText += cleanDelta;
											const msg: BtcaStreamTextDeltaEvent = {
												type: 'text.delta',
												delta: cleanDelta
											};
											emit(controller, msg);
										}
									}
									continue;
								}

								if (part.type === 'reasoning') {
									const partId = String(part.id);
									const nextText = String(part.text ?? '');
									const delta = updateAccumulator(reasoning, partId, nextText);
									if (delta.length > 0) {
										reasoningEvents += 1;
										const msg: BtcaStreamReasoningDeltaEvent = { type: 'reasoning.delta', delta };
										emit(controller, msg);
									}
									continue;
								}

								if (part.type === 'tool') {
									const callID = String(part.callID);
									const tool = String(part.tool);
									const state = part.state as any;

									const update: BtcaStreamToolUpdatedEvent = {
										type: 'tool.updated',
										callID,
										tool,
										state
									};
									toolUpdates += 1;
									toolsByCallId.set(callID, { callID, tool, state });
									emit(controller, update);
									continue;
								}
							}

							if (event.type === 'session.idle') {
								const tools = Array.from(toolsByCallId.values());

								// Flush any remaining buffered content from the tag stripper
								const flushed = tagStripper.flush();
								if (flushed.length > 0) {
									emittedText += flushed;
								}

								// Strip the echoed user question from the final text
								let finalText = stripUserQuestionFromStart(emittedText, coreQuestion);

								Metrics.info('stream.done', {
									collectionKey: args.meta.collection.key,
									textLength: finalText.length,
									reasoningLength: reasoning.combined.length,
									toolCount: tools.length,
									toolUpdates,
									textEvents,
									reasoningEvents
								});

								const done: BtcaStreamDoneEvent = {
									type: 'done',
									text: finalText,
									reasoning: reasoning.combined,
									tools
								};
								emit(controller, done);
								continue;
							}
						}
					} catch (cause) {
						Metrics.error('stream.error', {
							collectionKey: args.meta.collection.key,
							error: Metrics.errorInfo(cause)
						});
						const err: BtcaStreamErrorEvent = {
							type: 'error',
							tag: getErrorTag(cause),
							message: getErrorMessage(cause)
						};
						emit(controller, err);
					} finally {
						Metrics.info('stream.closed', { collectionKey: args.meta.collection.key });
						controller.close();
					}
				})();
			}
		});
	};
}
