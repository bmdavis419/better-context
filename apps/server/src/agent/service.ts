/**
 * Agent Service
 * Refactored to use custom AI SDK loop instead of spawning OpenCode instances
 */
import { Effect } from 'effect';

import type { ConfigService as ConfigServiceShape } from '../config/index.ts';
import { getErrorHint, getErrorMessage, type TaggedErrorOptions } from '../errors.ts';
import { metricsError, metricsErrorInfo, metricsInfo } from '../metrics/index.ts';
import {
	getAuthenticatedProviders,
	getProviderAuthHint,
	getSupportedProviders,
	isAuthenticated
} from '../providers/index.ts';
import type { CollectionResult } from '../collections/types.ts';
import { clearVirtualCollectionMetadata } from '../collections/virtual-metadata.ts';
import { disposeVirtualFs } from '../vfs/virtual-fs.ts';
import type { AgentResult } from './types.ts';
import { runAgentLoop, streamAgentLoop, type AgentEvent } from './loop.ts';

export class AgentError extends Error {
	readonly _tag = 'AgentError';
	override readonly cause?: unknown;
	readonly hint?: string;

	constructor(args: TaggedErrorOptions) {
		super(args.message);
		this.cause = args.cause;
		this.hint = args.hint;
	}
}

export class InvalidProviderError extends Error {
	readonly _tag = 'InvalidProviderError';
	readonly providerId: string;
	readonly availableProviders: string[];
	readonly hint: string;

	constructor(args: { providerId: string; availableProviders: string[] }) {
		super(`Invalid provider: "${args.providerId}"`);
		this.providerId = args.providerId;
		this.availableProviders = args.availableProviders;
		this.hint = `Available providers: ${args.availableProviders.join(
			', '
		)}. Update your config with a valid provider. Open an issue to request this provider: https://github.com/davis7dotsh/better-context/issues.`;
	}
}

export class InvalidModelError extends Error {
	readonly _tag = 'InvalidModelError';
	readonly providerId: string;
	readonly modelId: string;
	readonly availableModels: string[];
	readonly hint: string;

	constructor(args: { providerId: string; modelId: string; availableModels: string[] }) {
		super(`Invalid model "${args.modelId}" for provider "${args.providerId}"`);
		this.providerId = args.providerId;
		this.modelId = args.modelId;
		this.availableModels = args.availableModels;
		const modelList =
			args.availableModels.length <= 5
				? args.availableModels.join(', ')
				: `${args.availableModels.slice(0, 5).join(', ')}... (${args.availableModels.length} total)`;
		this.hint = `Available models for ${args.providerId}: ${modelList}. Update your config with a valid model.`;
	}
}

export class ProviderNotConnectedError extends Error {
	readonly _tag = 'ProviderNotConnectedError';
	readonly providerId: string;
	readonly connectedProviders: string[];
	readonly hint: string;

	constructor(args: { providerId: string; connectedProviders: string[] }) {
		super(`Provider "${args.providerId}" is not connected`);
		this.providerId = args.providerId;
		this.connectedProviders = args.connectedProviders;
		const baseHint = getProviderAuthHint(args.providerId);
		if (args.connectedProviders.length > 0) {
			this.hint = `${baseHint} Connected providers: ${args.connectedProviders.join(', ')}.`;
		} else {
			this.hint = `${baseHint} No providers are currently connected.`;
		}
	}
}

export type AgentService = {
	askStream: (args: { collection: CollectionResult; question: string }) => Effect.Effect<
		{
			stream: AsyncIterable<AgentEvent>;
			model: { provider: string; model: string };
		},
		unknown
	>;

	ask: (args: {
		collection: CollectionResult;
		question: string;
	}) => Effect.Effect<AgentResult, unknown>;

	listProviders: () => Effect.Effect<
		{
			all: { id: string; models: Record<string, unknown> }[];
			connected: string[];
		},
		unknown
	>;
};

export type Service = AgentService;

export const createAgentService = (config: ConfigServiceShape): AgentService => {
	const cleanupCollection = async (collection: CollectionResult) => {
		if (collection.vfsId) {
			disposeVirtualFs(collection.vfsId);
			clearVirtualCollectionMetadata(collection.vfsId);
		}
		try {
			await collection.cleanup?.();
		} catch {
			return;
		}
	};

	const ensureProviderConnected = async () => {
		const isAuthed = await isAuthenticated(config.provider);
		const requiresAuth = config.provider !== 'openai-compat';
		if (isAuthed || !requiresAuth) return;
		const authenticated = await getAuthenticatedProviders();
		throw new ProviderNotConnectedError({
			providerId: config.provider,
			connectedProviders: authenticated
		});
	};

	/**
	 * Ask a question and stream the response using the new AI SDK loop
	 */
	const askStreamImpl = async ({
		collection,
		question
	}: {
		collection: CollectionResult;
		question: string;
	}) => {
		metricsInfo('agent.ask.start', {
			provider: config.provider,
			model: config.model,
			questionLength: question.length
		});

		try {
			await ensureProviderConnected();
		} catch (error) {
			await cleanupCollection(collection);
			throw error;
		}

		// Create a generator that wraps the AgentLoop stream
		const eventGenerator = (async function* () {
			try {
				const stream = streamAgentLoop({
					providerId: config.provider,
					modelId: config.model,
					maxSteps: config.maxSteps,
					collectionPath: collection.path,
					vfsId: collection.vfsId,
					agentInstructions: collection.agentInstructions,
					question,
					providerOptions: config.getProviderOptions(config.provider)
				});
				for await (const event of stream) {
					yield event;
				}
			} finally {
				await cleanupCollection(collection);
			}
		})();

		return {
			stream: eventGenerator,
			model: { provider: config.provider, model: config.model }
		};
	};

	/**
	 * Ask a question and return the complete response
	 */
	const askImpl = async ({
		collection,
		question
	}: {
		collection: CollectionResult;
		question: string;
	}) => {
		try {
			metricsInfo('agent.ask.start', {
				provider: config.provider,
				model: config.model,
				questionLength: question.length
			});

			await ensureProviderConnected();

			let result: Awaited<ReturnType<typeof runAgentLoop>>;
			try {
				result = await runAgentLoop({
					providerId: config.provider,
					modelId: config.model,
					maxSteps: config.maxSteps,
					collectionPath: collection.path,
					vfsId: collection.vfsId,
					agentInstructions: collection.agentInstructions,
					question,
					providerOptions: config.getProviderOptions(config.provider)
				});
			} catch (cause) {
				throw new AgentError({
					message: getErrorMessage(cause),
					hint:
						getErrorHint(cause) ?? 'This may be a temporary issue. Try running the command again.',
					cause
				});
			}

			metricsInfo('agent.ask.complete', {
				provider: config.provider,
				model: config.model,
				answerLength: result.answer.length,
				eventCount: result.events.length
			});

			return {
				answer: result.answer,
				model: result.model,
				events: result.events
			};
		} catch (error) {
			metricsError('agent.ask.error', { error: metricsErrorInfo(error) });
			throw error;
		} finally {
			await cleanupCollection(collection);
		}
	};

	/**
	 * List available providers using local auth data
	 */
	const listProvidersImpl = async () => {
		const supportedProviders = getSupportedProviders();
		const authenticatedProviders = await getAuthenticatedProviders();
		const all = supportedProviders.map((id) => ({
			id,
			models: {} as Record<string, unknown>
		}));

		return {
			all,
			connected: authenticatedProviders
		};
	};

	const askStream: AgentService['askStream'] = (args) =>
		Effect.tryPromise({
			try: () => askStreamImpl(args),
			catch: (cause) => cause
		});
	const ask: AgentService['ask'] = (args) =>
		Effect.tryPromise({
			try: () => askImpl(args),
			catch: (cause) => cause
		});
	const listProviders: AgentService['listProviders'] = () =>
		Effect.tryPromise({
			try: () => listProvidersImpl(),
			catch: (cause) => cause
		});

	return {
		askStream,
		ask,
		listProviders
	};
};
