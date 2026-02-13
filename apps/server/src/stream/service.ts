import { stripUserQuestionFromStart, extractCoreQuestion } from '@btca/shared';
import { Result } from 'better-result';

import { getErrorHint, getErrorMessage, getErrorTag } from '../errors.ts';
import { Metrics } from '../metrics/index.ts';
import type { AgentLoop } from '../agent/loop.ts';

import type {
	BtcaStreamDoneEvent,
	BtcaStreamErrorEvent,
	BtcaStreamEvent,
	BtcaStreamMetaEvent,
	BtcaStreamReasoningDeltaEvent,
	BtcaStreamTextDeltaEvent,
	BtcaStreamToolUpdatedEvent
} from './types.ts';

const toSse = (event: BtcaStreamEvent): string => {
	// Standard SSE: an event name + JSON payload.
	return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number) => {
	const timeout = (async () => {
		await sleep(timeoutMs);
		throw new Error('timeout');
	})();
	return Promise.race([promise, timeout]);
};

const hasAnyDefined = (record: Record<string, unknown> | undefined) =>
	Boolean(record && Object.values(record).some((v) => v != null));

const costFor = (tokens: number | undefined, usdPerMTokens: number | undefined) =>
	tokens == null || usdPerMTokens == null ? undefined : (tokens / 1_000_000) * usdPerMTokens;

export namespace StreamService {
	export const createSseStream = (args: {
		meta: BtcaStreamMetaEvent;
		eventStream: AsyncIterable<AgentLoop.AgentEvent>;
		question?: string; // Original question - used to filter echoed user message
		requestStartMs?: number;
		pricing?: {
			lookup: (args: { providerId: string; modelId: string; timeoutMs?: number }) => Promise<{
				source: 'models.dev';
				modelKey: string;
				ratesUsdPerMTokens: {
					input?: number;
					output?: number;
					reasoning?: number;
					cacheRead?: number;
					cacheWrite?: number;
				};
			} | null>;
		};
		pricingTimeoutMs?: number;
	}): ReadableStream<Uint8Array> => {
		const encoder = new TextEncoder();

		let closed = false;

		const emit = (
			controller: ReadableStreamDefaultController<Uint8Array>,
			event: BtcaStreamEvent
		) => {
			if (closed) return;
			try {
				controller.enqueue(encoder.encode(toSse(event)));
			} catch {
				// If the client disconnects/cancels, the controller may already be closed.
				closed = true;
			}
		};

		// Track accumulated text and tool state
		let accumulatedText = '';
		let emittedText = '';
		let accumulatedReasoning = '';
		const toolsByCallId = new Map<string, Omit<BtcaStreamToolUpdatedEvent, 'type'>>();
		let textEvents = 0;
		let toolEvents = 0;
		let reasoningEvents = 0;

		const requestStartMs = args.requestStartMs ?? performance.now();
		let streamStartMs = requestStartMs;

		// Extract the core question for stripping echoed user message from final response
		const coreQuestion = extractCoreQuestion(args.question);

		return new ReadableStream<Uint8Array>({
			start(controller) {
				streamStartMs = performance.now();
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

								case 'reasoning-delta': {
									reasoningEvents += 1;
									accumulatedReasoning += event.text;
									const msg: BtcaStreamReasoningDeltaEvent = {
										type: 'reasoning.delta',
										delta: event.text
									};
									emit(controller, msg);
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
									const finishedAtMs = performance.now();
									const tools = Array.from(toolsByCallId.values());

									// Strip the echoed user question from the final text
									const finalText = stripUserQuestionFromStart(accumulatedText, coreQuestion);
									emittedText = finalText;

									const usage = hasAnyDefined(event.usage as Record<string, unknown> | undefined)
										? {
												inputTokens: event.usage?.inputTokens,
												outputTokens: event.usage?.outputTokens,
												reasoningTokens: event.usage?.reasoningTokens,
												totalTokens: event.usage?.totalTokens
											}
										: undefined;

									const totalMs = Math.max(0, finishedAtMs - requestStartMs);
									const genMs = Math.max(0, finishedAtMs - streamStartMs);

									const throughput =
										genMs > 0 && usage
											? {
													outputTokensPerSecond:
														usage.outputTokens == null
															? undefined
															: usage.outputTokens / (genMs / 1000),
													totalTokensPerSecond:
														usage.totalTokens == null
															? undefined
															: usage.totalTokens / (genMs / 1000)
												}
											: undefined;

									const pricingTimeoutMs = args.pricingTimeoutMs ?? 250;
									const pricingLookup = args.pricing
										? withTimeout(
												args.pricing.lookup({
													providerId: args.meta.model.provider,
													modelId: args.meta.model.model,
													timeoutMs: pricingTimeoutMs
												}),
												pricingTimeoutMs
											).catch(() => null)
										: Promise.resolve(null);

									const pricingResult = await pricingLookup;

									const pricing =
										pricingResult && usage
											? (() => {
													const rates = pricingResult.ratesUsdPerMTokens;
													const input = costFor(usage.inputTokens, rates.input);
													const output = costFor(usage.outputTokens, rates.output);
													const reasoning = costFor(usage.reasoningTokens, rates.reasoning);
													const hasAnyCostPart =
														input != null || output != null || reasoning != null;
													const total = (input ?? 0) + (output ?? 0) + (reasoning ?? 0);

													return {
														source: 'models.dev' as const,
														modelKey: pricingResult.modelKey,
														ratesUsdPerMTokens: rates,
														...(hasAnyCostPart
															? {
																	costUsd: {
																		...(input == null ? {} : { input }),
																		...(output == null ? {} : { output }),
																		...(reasoning == null ? {} : { reasoning }),
																		total
																	}
																}
															: {})
													};
												})()
											: pricingResult
												? {
														source: 'models.dev' as const,
														modelKey: pricingResult.modelKey,
														ratesUsdPerMTokens: pricingResult.ratesUsdPerMTokens
													}
												: undefined;

									Metrics.info('stream.done', {
										collectionKey: args.meta.collection.key,
										textLength: finalText.length,
										reasoningLength: accumulatedReasoning.length,
										toolCount: tools.length,
										textEvents,
										toolEvents,
										reasoningEvents,
										finishReason: event.finishReason,
										totalMs,
										genMs,
										usage,
										pricingModelKey: pricingResult?.modelKey ?? null
									});

									const done: BtcaStreamDoneEvent = {
										type: 'done',
										text: finalText,
										reasoning: accumulatedReasoning,
										tools,
										...(usage ? { usage } : {}),
										metrics: {
											timing: { totalMs, genMs },
											...(throughput ? { throughput } : {}),
											...(pricing ? { pricing } : {})
										}
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
										message: getErrorMessage(event.error),
										hint: getErrorHint(event.error)
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
								message: getErrorMessage(cause),
								hint: getErrorHint(cause)
							};
							emit(controller, err);
						}
					});

					{
						Metrics.info('stream.closed', { collectionKey: args.meta.collection.key });
						if (!closed) {
							closed = true;
							try {
								controller.close();
							} catch {
								// Ignore double-close: cancellation/termination may have already closed the stream.
							}
						}
					}
				})();
			},

			cancel() {
				closed = true;
			}
		});
	};
}
