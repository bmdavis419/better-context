import { stripUserQuestionFromStart, extractCoreQuestion } from '@btca/shared';
import { Result } from 'better-result';

import { getErrorMessage, getErrorTag } from '../errors.ts';
import { Metrics } from '../metrics/index.ts';
import type { AgentLoop } from '../agent/loop.ts';

import type {
	BtcaStreamDoneEvent,
	BtcaStreamErrorEvent,
	BtcaStreamEvent,
	BtcaStreamMetaEvent,
	BtcaStreamTextDeltaEvent,
	BtcaStreamToolUpdatedEvent
} from './types.ts';

const toSse = (event: BtcaStreamEvent): string => {
	// Standard SSE: an event name + JSON payload.
	return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
};

export namespace StreamService {
	export const createSseStream = (args: {
		meta: BtcaStreamMetaEvent;
		eventStream: AsyncIterable<AgentLoop.AgentEvent>;
		question?: string; // Original question - used to filter echoed user message
	}): ReadableStream<Uint8Array> => {
		const encoder = new TextEncoder();

		const emit = (
			controller: ReadableStreamDefaultController<Uint8Array>,
			event: BtcaStreamEvent
		) => {
			controller.enqueue(encoder.encode(toSse(event)));
		};

		// Track accumulated text and tool state
		let accumulatedText = '';
		let emittedText = '';
		const toolsByCallId = new Map<string, Omit<BtcaStreamToolUpdatedEvent, 'type'>>();
		let textEvents = 0;
		let toolEvents = 0;

		// Extract the core question for stripping echoed user message from final response
		const coreQuestion = extractCoreQuestion(args.question);

		return new ReadableStream<Uint8Array>({
			start(controller) {
				Metrics.info('stream.start', {
					collectionKey: args.meta.collection.key,
					resources: args.meta.resources,
					model: args.meta.model
				});

				emit(controller, args.meta);

				(async () => {
					const result = await Result.tryPromise(async () => {
						for await (const event of args.eventStream) {
							switch (event.type) {
								case 'text-delta': {
									textEvents += 1;
									accumulatedText += event.text;

									const nextText = stripUserQuestionFromStart(accumulatedText, coreQuestion);
									const delta = nextText.slice(emittedText.length);
									if (delta) {
										emittedText = nextText;
										const msg: BtcaStreamTextDeltaEvent = {
											type: 'text.delta',
											delta
										};
										emit(controller, msg);
									}
									break;
								}

								case 'tool-call': {
									toolEvents += 1;
									const callID = `tool-${toolEvents}`;

									// Store tool call info
									toolsByCallId.set(callID, {
										callID,
										tool: event.toolName,
										state: {
											status: 'running',
											input: event.input
										}
									});

									const update: BtcaStreamToolUpdatedEvent = {
										type: 'tool.updated',
										callID,
										tool: event.toolName,
										state: {
											status: 'running',
											input: event.input
										}
									};
									emit(controller, update);
									break;
								}

								case 'tool-result': {
									// Find the tool call and update its state
									for (const [callID, tool] of toolsByCallId) {
										if (tool.tool === event.toolName && tool.state?.status === 'running') {
											tool.state = {
												status: 'completed',
												input: tool.state.input,
												output: event.output
											};

											const update: BtcaStreamToolUpdatedEvent = {
												type: 'tool.updated',
												callID,
												tool: event.toolName,
												state: tool.state
											};
											emit(controller, update);
											break;
										}
									}
									break;
								}

								case 'finish': {
									const tools = Array.from(toolsByCallId.values());

									// Strip the echoed user question from the final text
									const finalText = stripUserQuestionFromStart(accumulatedText, coreQuestion);
									emittedText = finalText;

									Metrics.info('stream.done', {
										collectionKey: args.meta.collection.key,
										textLength: finalText.length,
										toolCount: tools.length,
										textEvents,
										toolEvents,
										finishReason: event.finishReason
									});

									const done: BtcaStreamDoneEvent = {
										type: 'done',
										text: finalText,
										reasoning: '', // We don't have reasoning in the new format
										tools
									};
									emit(controller, done);
									break;
								}

								case 'error': {
									Metrics.error('stream.error', {
										collectionKey: args.meta.collection.key,
										error: Metrics.errorInfo(event.error)
									});
									const err: BtcaStreamErrorEvent = {
										type: 'error',
										tag: getErrorTag(event.error),
										message: getErrorMessage(event.error)
									};
									emit(controller, err);
									break;
								}
							}
						}
					});

					result.match({
						ok: () => undefined,
						err: (cause) => {
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
						}
					});

					{
						Metrics.info('stream.closed', { collectionKey: args.meta.collection.key });
						controller.close();
					}
				})();
			}
		});
	};
}
