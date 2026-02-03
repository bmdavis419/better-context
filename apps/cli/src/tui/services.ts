import { Result } from 'better-result';
import type { BtcaStreamEvent } from 'btca-server/stream/types';

import {
	createClient,
	getConfig,
	getResources,
	getProviders as getProvidersClient,
	askQuestionStream,
	updateModel as updateModelClient,
	addResource as addResourceClient,
	removeResource as removeResourceClient,
	type ProviderOptionsInput,
	type ResourceInput
} from '../client/index.ts';
import { parseSSEStream } from '../client/stream.ts';
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
	 * Get all resources as Repos (only git resources for now)
	 */
	getRepos: async (): Promise<Repo[]> => {
		const client = createClient(getServerUrl());
		const { resources } = await getResources(client);
		return resources
			.filter((r) => r.type === 'git')
			.map((r) => ({
				name: r.name,
				url: r.url ?? '',
				branch: r.branch ?? 'main',
				specialNotes: r.specialNotes ?? undefined,
				searchPath: r.searchPath ?? undefined,
				searchPaths: r.searchPaths ?? undefined
			}));
	},

	/**
	 * Get current model config
	 */
	getModel: async (): Promise<{ provider: string; model: string }> => {
		const client = createClient(getServerUrl());
		const config = await getConfig(client);
		return { provider: config.provider, model: config.model };
	},

	/**
	 * Get provider connection status
	 */
	getProviders: async () => {
		const client = createClient(getServerUrl());
		return getProvidersClient(client);
	},

	/**
	 * Ask a question across multiple resources
	 */
	askQuestion: async (
		resourceNames: string[],
		question: string,
		onChunkUpdate: (update: ChunkUpdate) => void
	): Promise<BtcaChunk[]> => {
		const serverUrl = getServerUrl();

		// Create abort controller for this request
		currentAbortController = new AbortController();
		const signal = currentAbortController.signal;

		const response = await askQuestionStream(serverUrl, {
			question,
			resources: resourceNames,
			quiet: true,
			signal
		});

		// Track chunks by ID for updates, and order separately for display
		const chunksById = new Map<string, BtcaChunk>();
		const chunkOrder: string[] = [];

		const streamResult = await Result.tryPromise(async () => {
			for await (const event of parseSSEStream(response)) {
				if (signal.aborted) break;
				processStreamEvent(event, chunksById, chunkOrder, onChunkUpdate);
			}
		});
		if (streamResult.isErr()) {
			const error = streamResult.error;
			if (!(error instanceof Error && error.name === 'AbortError')) {
				throw error;
			}
		}

		currentAbortController = null;
		return chunkOrder.map((id) => chunksById.get(id)!);
	},

	/**
	 * Cancel the current request
	 */
	cancelCurrentRequest: async (): Promise<void> => {
		if (currentAbortController) {
			currentAbortController.abort();
			currentAbortController = null;
			await trackTelemetryEvent({
				event: 'cli_stream_cancelled',
				properties: { command: 'btca', mode: 'tui' }
			});
		}
	},

	/**
	 * Update model configuration
	 */
	updateModel: async (
		provider: string,
		model: string,
		providerOptions?: ProviderOptionsInput
	): Promise<ModelUpdateResult> => {
		const serverUrl = getServerUrl();
		return updateModelClient(serverUrl, provider, model, providerOptions);
	},

	/**
	 * Add a new resource
	 */
	addResource: async (resource: ResourceInput): Promise<ResourceInput> => {
		const serverUrl = getServerUrl();
		return addResourceClient(serverUrl, resource);
	},

	/**
	 * Remove a resource
	 */
	removeResource: async (name: string): Promise<void> => {
		const serverUrl = getServerUrl();
		return removeResourceClient(serverUrl, name);
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

export type Services = typeof services;
