import {
	createOpencode,
	createOpencodeClient,
	type Config as OpenCodeConfig,
	type OpencodeClient,
	type Event as OcEvent
} from '@opencode-ai/sdk';

import { Config } from '../config/index.ts';
import { CommonHints, type TaggedErrorOptions } from '../errors.ts';
import { Metrics } from '../metrics/index.ts';
import type { CollectionResult } from '../collections/types.ts';
import type { AgentResult } from './types.ts';

export namespace Agent {
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
			this.hint = `Available providers: ${args.availableProviders.join(', ')}. Update your config with a valid provider.`;
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
			if (args.connectedProviders.length > 0) {
				this.hint = `${CommonHints.RUN_AUTH} Connected providers: ${args.connectedProviders.join(', ')}.`;
			} else {
				this.hint = `${CommonHints.RUN_AUTH} No providers are currently connected.`;
			}
		}
	}

	export type Service = {
		askStream: (args: {
			collection: CollectionResult;
			question: string;
		}) => Promise<{ stream: AsyncIterable<OcEvent>; model: { provider: string; model: string } }>;

		ask: (args: { collection: CollectionResult; question: string }) => Promise<AgentResult>;

		getOpencodeInstance: (args: { collection: CollectionResult }) => Promise<{
			url: string;
			model: { provider: string; model: string };
		}>;

		listProviders: () => Promise<{
			all: { id: string; models: Record<string, unknown> }[];
			connected: string[];
		}>;
	};

	const buildOpenCodeConfig = (args: {
		agentInstructions: string;
		providerId?: string;
		providerTimeoutMs?: number;
	}): OpenCodeConfig => {
		const prompt = [
			'You are an expert internal agent whose job is to answer questions about the collection.',
			'You operate inside a collection directory.',
			"Use the resources in this collection to answer the user's question.",
			args.agentInstructions
		].join('\n');

		const providerConfig =
			args.providerId && typeof args.providerTimeoutMs === 'number'
				? {
						[args.providerId]: {
							options: {
								timeout: args.providerTimeoutMs
							}
						}
					}
				: undefined;

		return {
			agent: {
				build: { disable: true },
				explore: { disable: true },
				general: { disable: true },
				plan: { disable: true },
				docs: {
					prompt,
					description: 'Answer questions by searching the collection',
					permission: {
						webfetch: 'deny',
						edit: 'deny',
						bash: 'deny',
						external_directory: 'deny',
						doom_loop: 'deny'
					},
					mode: 'primary',
					tools: {
						write: false,
						bash: false,
						delete: false,
						read: true,
						grep: true,
						glob: true,
						list: true,
						path: false,
						todowrite: false,
						todoread: false,
						websearch: false,
						webfetch: false,
						skill: false,
						task: false,
						mcp: false,
						edit: false
					}
				}
			},
			...(providerConfig ? { provider: providerConfig } : {})
		};
	};

	const validateProviderAndModel = async (
		client: OpencodeClient,
		providerId: string,
		modelId: string
	) => {
		const response = await client.provider.list().catch(() => null);
		if (!response?.data) return;

		type ProviderInfo = { id: string; models: Record<string, unknown> };
		const data = response.data as { all: ProviderInfo[]; connected: string[] };

		const { all, connected } = data;
		const provider = all.find((p) => p.id === providerId);
		if (!provider)
			throw new InvalidProviderError({ providerId, availableProviders: all.map((p) => p.id) });
		if (!connected.includes(providerId)) {
			throw new ProviderNotConnectedError({ providerId, connectedProviders: connected });
		}

		const modelIds = Object.keys(provider.models);
		if (!modelIds.includes(modelId)) {
			throw new InvalidModelError({ providerId, modelId, availableModels: modelIds });
		}
	};

	const createOpencodeInstance = async (args: {
		collectionPath: string;
		ocConfig: OpenCodeConfig;
	}): Promise<{
		client: OpencodeClient;
		server: { close(): void; url: string };
		baseUrl: string;
	}> => {
		const maxAttempts = 10;
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const port = Math.floor(Math.random() * 3000) + 3000;
			const created = await createOpencode({ port, config: args.ocConfig }).catch((err: any) => {
				if (err?.cause instanceof Error && err.cause.stack?.includes('port')) return null;
				throw new AgentError({
					message: 'Failed to create OpenCode instance',
					hint: 'This may be a temporary issue. Try running the command again.',
					cause: err
				});
			});

			if (created) {
				const baseUrl = `http://localhost:${port}`;
				return {
					client: createOpencodeClient({ baseUrl, directory: args.collectionPath }),
					server: created.server,
					baseUrl
				};
			}
		}

		throw new AgentError({
			message: 'Failed to create OpenCode instance - all port attempts exhausted',
			hint: 'Check if you have too many btca processes running. Try closing other terminal sessions or restarting your machine.'
		});
	};

	const sessionEvents = async (args: {
		sessionID: string;
		client: OpencodeClient;
	}): Promise<AsyncIterable<OcEvent>> => {
		const events = await args.client.event.subscribe().catch((cause: unknown) => {
			throw new AgentError({
				message: 'Failed to subscribe to events',
				hint: 'This may be a temporary connection issue. Try running the command again.',
				cause
			});
		});

		async function* gen() {
			for await (const event of events.stream) {
				const props = event.properties as any;
				if (props && 'sessionID' in props && props.sessionID !== args.sessionID) continue;
				yield event;
				if (
					event.type === 'session.idle' &&
					(event.properties as any)?.sessionID === args.sessionID
				)
					return;
			}
		}

		return gen();
	};

	const extractAnswerFromEvents = (events: readonly OcEvent[]): string => {
		const partIds: string[] = [];
		const partText = new Map<string, string>();

		for (const event of events) {
			if (event.type !== 'message.part.updated') continue;
			const part: any = (event.properties as any).part;
			if (!part || part.type !== 'text') continue;
			if (!partIds.includes(part.id)) partIds.push(part.id);
			partText.set(part.id, String(part.text ?? ''));
		}

		return partIds
			.map((id) => partText.get(id) ?? '')
			.join('')
			.trim();
	};

	export const create = (config: Config.Service): Service => {
		const askStream: Service['askStream'] = async ({ collection, question }) => {
			const ocConfig = buildOpenCodeConfig({
				agentInstructions: collection.agentInstructions,
				providerId: config.provider,
				providerTimeoutMs: config.providerTimeoutMs
			});
			const { client, server, baseUrl } = await createOpencodeInstance({
				collectionPath: collection.path,
				ocConfig
			});

			Metrics.info('agent.oc.ready', { baseUrl, collectionPath: collection.path });

			try {
				try {
					await validateProviderAndModel(client, config.provider, config.model);
					Metrics.info('agent.validate.ok', { provider: config.provider, model: config.model });
				} catch (cause) {
					// Re-throw if it's already one of our specific error types with hints
					if (
						cause instanceof InvalidProviderError ||
						cause instanceof InvalidModelError ||
						cause instanceof ProviderNotConnectedError
					) {
						throw cause;
					}
					throw new AgentError({
						message: 'Provider/model validation failed',
						hint: `Check that provider "${config.provider}" and model "${config.model}" are valid. ${CommonHints.RUN_AUTH}`,
						cause
					});
				}

				const session = await client.session.create().catch((cause: unknown) => {
					throw new AgentError({
						message: 'Failed to create session',
						hint: 'This may be a temporary issue with the OpenCode instance. Try running the command again.',
						cause
					});
				});

				if (session.error)
					throw new AgentError({
						message: 'Failed to create session',
						hint: 'The OpenCode server returned an error. Try running the command again.',
						cause: session.error
					});

				const sessionID = session.data?.id;
				if (!sessionID) {
					throw new AgentError({
						message: 'Failed to create session - no session ID returned',
						hint: 'This is unexpected. Try running the command again or check for btca updates.',
						cause: new Error('Missing session id')
					});
				}
				Metrics.info('agent.session.created', { sessionID });

				const eventStream = await sessionEvents({ sessionID, client });

				Metrics.info('agent.prompt.sent', { sessionID, questionLength: question.length });
				void client.session
					.prompt({
						path: { id: sessionID },
						body: {
							agent: 'docs',
							model: { providerID: config.provider, modelID: config.model },
							parts: [{ type: 'text', text: question }]
						}
					})
					.catch((cause: unknown) => {
						Metrics.error('agent.prompt.err', { error: Metrics.errorInfo(cause) });
					});

				async function* filtered() {
					try {
						for await (const event of eventStream) {
							if (event.type === 'session.error') {
								const props: any = event.properties;
								throw new AgentError({
									message: props?.error?.name ?? 'Unknown session error',
									hint: 'An error occurred during the AI session. Try running the command again or simplify your question.',
									cause: props?.error
								});
							}
							yield event;
						}
					} finally {
						Metrics.info('agent.session.closed', { sessionID });
						server.close();
					}
				}

				return {
					stream: filtered(),
					model: { provider: config.provider, model: config.model }
				};
			} catch (cause) {
				server.close();
				throw cause;
			}
		};

		const ask: Service['ask'] = async ({ collection, question }) => {
			const { stream, model } = await askStream({ collection, question });
			const events: OcEvent[] = [];
			for await (const event of stream) events.push(event);
			return { answer: extractAnswerFromEvents(events), model, events };
		};

		const getOpencodeInstanceMethod: Service['getOpencodeInstance'] = async ({ collection }) => {
			const ocConfig = buildOpenCodeConfig({
				agentInstructions: collection.agentInstructions,
				providerId: config.provider,
				providerTimeoutMs: config.providerTimeoutMs
			});
			const { baseUrl } = await createOpencodeInstance({
				collectionPath: collection.path,
				ocConfig
			});

			Metrics.info('agent.oc.instance.ready', { baseUrl, collectionPath: collection.path });

			// Note: The server stays alive - it's the caller's responsibility to manage the lifecycle
			// For CLI usage, the opencode CLI will connect to this instance and manage it

			return {
				url: baseUrl,
				model: { provider: config.provider, model: config.model }
			};
		};

		const listProviders: Service['listProviders'] = async () => {
			const ocConfig = buildOpenCodeConfig({
				agentInstructions: '',
				providerId: config.provider,
				providerTimeoutMs: config.providerTimeoutMs
			});
			const { client, server } = await createOpencodeInstance({
				collectionPath: process.cwd(),
				ocConfig
			});

			try {
				const response = await client.provider.list().catch((cause: unknown) => {
					throw new AgentError({
						message: 'Failed to fetch provider list',
						hint: CommonHints.RUN_AUTH,
						cause
					});
				});
				if (!response?.data) {
					throw new AgentError({
						message: 'Failed to fetch provider list',
						hint: CommonHints.RUN_AUTH
					});
				}
				const data = response.data as {
					all: { id: string; models: Record<string, unknown> }[];
					connected: string[];
				};
				return { all: data.all, connected: data.connected };
			} finally {
				server.close();
			}
		};

		return { askStream, ask, getOpencodeInstance: getOpencodeInstanceMethod, listProviders };
	};
}
