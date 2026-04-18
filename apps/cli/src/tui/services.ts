import { Effect } from 'effect';
import type { BtcaStreamEvent } from 'btca-server/stream/types';

import {
	createClient,
	getConfigEffect,
	getResourcesEffect,
	getProvidersEffect,
	askQuestionStreamEffect,
	updateModelEffect,
	addResourceEffect,
	removeResourceEffect,
	type ProviderOptionsInput,
	type ResourceInput
} from '../client/index.ts';
import { parseSSEStream } from '../client/stream.ts';
import { runCliEffect } from '../effect/runtime.ts';
import type { Repo, BtcaChunk } from './types.ts';
import { trackTelemetryEvent } from '../lib/telemetry.ts';

// Get server URL from global (set by TUI launcher)
const getServerUrl = (): string => {
	const server = globalThis.__BTCA_SERVER__;
	if (!server) throw new Error('Server not initialized');
	return server.url;
};

// Current request abort controller for cancellation
let currentAbortController: AbortController | null = null;

export type ChunkUpdate =
	| { type: 'add'; chunk: BtcaChunk }
	| { type: 'update'; id: string; chunk: Partial<BtcaChunk> };

export interface ModelUpdateResult {
	provider: string;
	model: string;
}

export const services = {
	/**
	 * Get all configured resources for @mention autocomplete
	 */
	getRepos: async (): Promise<Repo[]> => {
		return runCliEffect(
			Effect.gen(function* () {
				const client = createClient(getServerUrl());
				const { resources } = yield* getResourcesEffect(client);
				return resources.map((r) => ({
					name: r.name,
					type: r.type,
					url:
						r.type === 'git'
							? (r.url ?? '')
							: r.type === 'local'
								? (r.path ?? '')
								: (r.package ?? ''),
					branch: r.type === 'git' ? (r.branch ?? 'main') : 'main',
					specialNotes: r.specialNotes ?? undefined,
					searchPath: r.type === 'git' ? (r.searchPath ?? undefined) : undefined,
					searchPaths: r.type === 'git' ? (r.searchPaths ?? undefined) : undefined
				}));
			})
		);
	},

	/**
	 * Get current model config
	 */
	getModel: async (): Promise<{ provider: string; model: string }> => {
		return runCliEffect(
			Effect.gen(function* () {
				const client = createClient(getServerUrl());
				const config = yield* getConfigEffect(client);
				return { provider: config.provider, model: config.model };
			})
		);
	},

	/**
	 * Get provider connection status
	 */
	getProviders: async () => {
		return runCliEffect(
			Effect.gen(function* () {
				const client = createClient(getServerUrl());
				return yield* getProvidersEffect(client);
			})
		);
	},

	/**
	 * Ask a question across multiple resources
	 */
	askQuestion: async (
		resourceNames: string[],
		question: string,
		onChunkUpdate: (update: ChunkUpdate) => void
	): Promise<{
		chunks: BtcaChunk[];
		doneEvent?: Extract<BtcaStreamEvent, { type: 'done' }>;
	}> =>
		runCliEffect(
			Effect.gen(function* () {
				const serverUrl = getServerUrl();
				currentAbortController = new AbortController();
				const signal = currentAbortController.signal;
				const response = yield* askQuestionStreamEffect(serverUrl, {
					question,
					resources: resourceNames,
					quiet: true,
					signal
				});
				const chunksById = new Map<string, BtcaChunk>();
				const chunkOrder: string[] = [];
				let doneEvent: Extract<BtcaStreamEvent, { type: 'done' }> | undefined;
				try {
					yield* Effect.tryPromise({
						try: () =>
							(async () => {
								for await (const event of parseSSEStream(response)) {
									if (signal.aborted) break;
									if (event.type === 'error') {
										throw new Error(formatTuiStreamError(event));
									}
									if (event.type === 'done') {
										doneEvent = event;
										continue;
									}
									processStreamEvent(event, chunksById, chunkOrder, onChunkUpdate);
								}
							})(),
						catch: (e) => (e instanceof Error ? e : new Error(String(e)))
					});
				} catch (error) {
					if (!(error instanceof Error && error.name === 'AbortError')) {
						return yield* Effect.fail(error);
					}
				}
				currentAbortController = null;
				return {
					chunks: chunkOrder.map((id) => chunksById.get(id)!),
					...(doneEvent ? { doneEvent } : {})
				};
			})
		),

	/**
	 * Cancel the current request
	 */
	cancelCurrentRequest: async (): Promise<void> => {
		await runCliEffect(
			Effect.gen(function* () {
				if (!currentAbortController) return;
				currentAbortController.abort();
				currentAbortController = null;
				yield* Effect.tryPromise({
					try: () =>
						trackTelemetryEvent({
							event: 'cli_stream_cancelled',
							properties: { command: 'btca', mode: 'tui' }
						}),
					catch: (e) => (e instanceof Error ? e : new Error(String(e)))
				});
			})
		);
	},

	/**
	 * Update model configuration
	 */
	updateModel: async (
		provider: string,
		model: string,
		providerOptions?: ProviderOptionsInput
	): Promise<ModelUpdateResult> => {
		return runCliEffect(updateModelEffect(getServerUrl(), provider, model, providerOptions));
	},

	/**
	 * Add a new resource
	 */
	addResource: async (resource: ResourceInput): Promise<ResourceInput> => {
		return runCliEffect(addResourceEffect(getServerUrl(), resource));
	},

	/**
	 * Remove a resource
	 */
	removeResource: async (name: string): Promise<void> => {
		await runCliEffect(removeResourceEffect(getServerUrl(), name));
	}
};

function processStreamEvent(
	event: BtcaStreamEvent,
	chunksById: Map<string, BtcaChunk>,
	chunkOrder: string[],
	onChunkUpdate: (update: ChunkUpdate) => void
): void {
	const streamOptions = globalThis.__BTCA_STREAM_OPTIONS__ ?? {
		showThinking: true,
		showTools: true
	};

	switch (event.type) {
		case 'text.delta': {
			// Accumulate text deltas into a single text chunk
			const textChunkId = '__text__';
			const existing = chunksById.get(textChunkId);
			if (existing && existing.type === 'text') {
				existing.text += event.delta;
				onChunkUpdate({ type: 'update', id: textChunkId, chunk: { text: existing.text } });
			} else {
				const chunk: BtcaChunk = { type: 'text', id: textChunkId, text: event.delta };
				chunksById.set(textChunkId, chunk);
				chunkOrder.push(textChunkId);
				onChunkUpdate({ type: 'add', chunk });
			}
			break;
		}

		case 'reasoning.delta': {
			if (!streamOptions.showThinking) return;
			// Accumulate reasoning deltas
			const reasoningChunkId = '__reasoning__';
			const existing = chunksById.get(reasoningChunkId);
			if (existing && existing.type === 'reasoning') {
				existing.text += event.delta;
				onChunkUpdate({ type: 'update', id: reasoningChunkId, chunk: { text: existing.text } });
			} else {
				const chunk: BtcaChunk = { type: 'reasoning', id: reasoningChunkId, text: event.delta };
				chunksById.set(reasoningChunkId, chunk);
				chunkOrder.push(reasoningChunkId);
				onChunkUpdate({ type: 'add', chunk });
			}
			break;
		}

		case 'tool.updated': {
			if (!streamOptions.showTools) return;
			const existing = chunksById.get(event.callID);
			const state =
				event.state.status === 'pending'
					? 'pending'
					: event.state.status === 'running'
						? 'running'
						: 'completed';

			if (existing && existing.type === 'tool') {
				existing.state = state;
				onChunkUpdate({ type: 'update', id: event.callID, chunk: { state } });
			} else {
				const chunk: BtcaChunk = {
					type: 'tool',
					id: event.callID,
					toolName: event.tool,
					state
				};
				chunksById.set(event.callID, chunk);
				chunkOrder.push(event.callID);
				onChunkUpdate({ type: 'add', chunk });
			}
			break;
		}

		case 'meta':
		case 'done':
		case 'error':
			// Handled elsewhere or informational
			break;
	}
}

const formatTuiStreamError = (event: Extract<BtcaStreamEvent, { type: 'error' }>) => {
	const authError =
		event.tag === 'ProviderNotAuthenticatedError' || event.message.includes('is not authenticated');
	const hint = authError
		? 'Run /connect to authenticate this provider, then try again.'
		: event.hint;
	return hint ? `${event.message}\n\nHint: ${hint}` : event.message;
};

export type Services = typeof services;
