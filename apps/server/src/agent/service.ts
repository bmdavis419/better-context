/**
 * Agent Service
 * Refactored to use custom AI SDK loop instead of spawning OpenCode instances
 */
import { Result } from 'better-result';

import { Config } from '../config/index.ts';
import { type TaggedErrorOptions } from '../errors.ts';
import { Metrics } from '../metrics/index.ts';
import { Auth, getSupportedProviders } from '../providers/index.ts';
import type { CollectionResult } from '../collections/types.ts';
import { clearVirtualCollectionMetadata } from '../collections/virtual-metadata.ts';
import { VirtualFs } from '../vfs/virtual-fs.ts';
import type { AgentResult } from './types.ts';
import { AgentLoop } from './loop.ts';

export namespace Agent {
	// ─────────────────────────────────────────────────────────────────────────────
	// Error Classes
	// ─────────────────────────────────────────────────────────────────────────────

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
			const baseHint = Auth.getProviderAuthHint(args.providerId);
			if (args.connectedProviders.length > 0) {
				this.hint = `${baseHint} Connected providers: ${args.connectedProviders.join(', ')}.`;
			} else {
				this.hint = `${baseHint} No providers are currently connected.`;
			}
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Service Type
	// ─────────────────────────────────────────────────────────────────────────────

	export type Service = {
		askStream: (args: { collection: CollectionResult; question: string }) => Promise<{
			stream: AsyncIterable<AgentLoop.AgentEvent>;
			model: { provider: string; model: string };
		}>;

		ask: (args: { collection: CollectionResult; question: string }) => Promise<AgentResult>;

		listProviders: () => Promise<{
			all: { id: string; models: Record<string, unknown> }[];
			connected: string[];
		}>;
	};

	// ─────────────────────────────────────────────────────────────────────────────
	// Service Factory
	// ─────────────────────────────────────────────────────────────────────────────

	export const create = (config: Config.Service): Service => {
		/**
		 * Ask a question and stream the response using the new AI SDK loop
		 */
		const askStream: Service['askStream'] = async ({ collection, question }) => {
			Metrics.info('agent.ask.start', {
				provider: config.provider,
				model: config.model,
				questionLength: question.length
			});

			const cleanup = () => {
				if (!collection.vfsId) return;
				VirtualFs.dispose(collection.vfsId);
				clearVirtualCollectionMetadata(collection.vfsId);
			};

			// Validate provider is authenticated
			const isAuthed = await Auth.isAuthenticated(config.provider);
			const requiresAuth = config.provider !== 'opencode' && config.provider !== 'openai-compat';
			if (!isAuthed && requiresAuth) {
				const authenticated = await Auth.getAuthenticatedProviders();
				cleanup();
				throw new ProviderNotConnectedError({
					providerId: config.provider,
					connectedProviders: authenticated
				});
			}

			// Create a generator that wraps the AgentLoop stream
			const eventGenerator = (async function* () {
				try {
					const stream = AgentLoop.stream({
						providerId: config.provider,
						modelId: config.model,
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
					cleanup();
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
		const ask: Service['ask'] = async ({ collection, question }) => {
			Metrics.info('agent.ask.start', {
				provider: config.provider,
				model: config.model,
				questionLength: question.length
			});

			const cleanup = () => {
				if (!collection.vfsId) return;
				VirtualFs.dispose(collection.vfsId);
				clearVirtualCollectionMetadata(collection.vfsId);
			};

			// Validate provider is authenticated
			const isAuthed = await Auth.isAuthenticated(config.provider);
			const requiresAuth = config.provider !== 'opencode' && config.provider !== 'openai-compat';
			if (!isAuthed && requiresAuth) {
				const authenticated = await Auth.getAuthenticatedProviders();
				cleanup();
				throw new ProviderNotConnectedError({
					providerId: config.provider,
					connectedProviders: authenticated
				});
			}

			const runResult = await Result.tryPromise(() =>
				AgentLoop.run({
					providerId: config.provider,
					modelId: config.model,
					collectionPath: collection.path,
					vfsId: collection.vfsId,
					agentInstructions: collection.agentInstructions,
					question,
					providerOptions: config.getProviderOptions(config.provider)
				})
			);

			cleanup();

			return runResult.match({
				ok: (result) => {
					Metrics.info('agent.ask.complete', {
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
				},
				err: (error) => {
					Metrics.error('agent.ask.error', { error: Metrics.errorInfo(error) });
					throw new AgentError({
						message: 'Failed to get response from AI',
						hint: 'This may be a temporary issue. Try running the command again.',
						cause: error
					});
				}
			});
		};

		/**
		 * List available providers using local auth data
		 */
		const listProviders: Service['listProviders'] = async () => {
			// Get all supported providers from registry
			const supportedProviders = getSupportedProviders();

			// Get authenticated providers from OpenCode's auth storage
			const authenticatedProviders = await Auth.getAuthenticatedProviders();

			// Build the response - we don't have model lists without spawning OpenCode,
			// so we return empty models for now
			const all = supportedProviders.map((id) => ({
				id,
				models: {} as Record<string, unknown>
			}));

			return {
				all,
				connected: authenticatedProviders
			};
		};

		return {
			askStream,
			ask,
			listProviders
		};
	};
}
