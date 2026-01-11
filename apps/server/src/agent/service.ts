import {
	createOpencode,
	createOpencodeClient,
	type Config as OpenCodeConfig,
	type OpencodeClient,
	type ProviderConfig,
	type Event as OcEvent
} from '@opencode-ai/sdk';

import { Config } from '../config/index.ts';
import { Metrics } from '../metrics/index.ts';
import type { CollectionResult } from '../collections/types.ts';
import type { AgentResult } from './types.ts';

export namespace Agent {
	export class AgentError extends Error {
		readonly _tag = 'AgentError';
		override readonly cause?: unknown;

		constructor(args: { message: string; cause?: unknown }) {
			super(args.message);
			this.cause = args.cause;
		}
	}

	export class InvalidProviderError extends Error {
		readonly _tag = 'InvalidProviderError';
		readonly providerId: string;
		readonly availableProviders: string[];

		constructor(args: { providerId: string; availableProviders: string[] }) {
			super(`Invalid provider: ${args.providerId}`);
			this.providerId = args.providerId;
			this.availableProviders = args.availableProviders;
		}
	}

	export class InvalidModelError extends Error {
		readonly _tag = 'InvalidModelError';
		readonly providerId: string;
		readonly modelId: string;
		readonly availableModels: string[];

		constructor(args: { providerId: string; modelId: string; availableModels: string[] }) {
			super(`Invalid model: ${args.modelId}`);
			this.providerId = args.providerId;
			this.modelId = args.modelId;
			this.availableModels = args.availableModels;
		}
	}

	export class ProviderNotConnectedError extends Error {
		readonly _tag = 'ProviderNotConnectedError';
		readonly providerId: string;
		readonly connectedProviders: string[];

		constructor(args: { providerId: string; connectedProviders: string[] }) {
			super(`Provider not connected: ${args.providerId}`);
			this.providerId = args.providerId;
			this.connectedProviders = args.connectedProviders;
		}
	}

	export type Service = {
		askStream: (args: {
			collection: CollectionResult;
			question: string;
		}) => Promise<{ stream: AsyncIterable<OcEvent>; model: { provider: string; model: string } }>;

		ask: (args: { collection: CollectionResult; question: string }) => Promise<AgentResult>;
	};

	const BTCA_PRESET_MODELS: Record<string, ProviderConfig> = {
		opencode: {
			models: {
				'btca-gemini-3-flash': {
					id: 'gemini-3-flash',
					options: {
						generationConfig: {
							thinkingConfig: {
								thinkingLevel: 'low'
							}
						}
					}
				}
			}
		}
	};

	const buildOpenCodeConfig = (args: { agentInstructions: string }): OpenCodeConfig => {
		const prompt = [
			'You are the btca server agent.',
			'You operate inside a collection directory.',
			"Only use relative paths within '.' and never use '..' or absolute paths.",
			'Do not leave the collection directory.',
			'',
			args.agentInstructions
		].join('\n');

		return {
			provider: BTCA_PRESET_MODELS,
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
			}
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

	const getOpencodeInstance = async (args: {
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
				throw new AgentError({ message: 'Failed to create OpenCode instance', cause: err });
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
			message: 'Failed to create OpenCode instance - all port attempts exhausted'
		});
	};

	const sessionEvents = async (args: {
		sessionID: string;
		client: OpencodeClient;
	}): Promise<AsyncIterable<OcEvent>> => {
		const events = await args.client.event.subscribe().catch((cause: unknown) => {
			throw new AgentError({ message: 'Failed to subscribe to events', cause });
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
			const ocConfig = buildOpenCodeConfig({ agentInstructions: collection.agentInstructions });
			const { client, server, baseUrl } = await getOpencodeInstance({
				collectionPath: collection.path,
				ocConfig
			});

			Metrics.info('agent.oc.ready', { baseUrl, collectionPath: collection.path });

			try {
				try {
					await validateProviderAndModel(client, config.provider, config.model);
					Metrics.info('agent.validate.ok', { provider: config.provider, model: config.model });
				} catch (cause) {
					throw new AgentError({ message: 'Provider/model validation failed', cause });
				}

				const session = await client.session.create().catch((cause: unknown) => {
					throw new AgentError({ message: 'Failed to create session', cause });
				});

				if (session.error)
					throw new AgentError({ message: 'Failed to create session', cause: session.error });

				const sessionID = session.data?.id;
				if (!sessionID) {
					throw new AgentError({
						message: 'Failed to create session',
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

		return { askStream, ask };
	};
}
