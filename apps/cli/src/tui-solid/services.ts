import { BunContext } from '@effect/platform-bun';
import { Effect, ManagedRuntime, Stream } from 'effect';
import {
	initializeCoreServices,
	getResourceInfos,
	streamToChunks,
	type CoreServices,
	type SessionState,
	type ChunkUpdate,
	type BtcaChunk
} from '../core/index.ts';
import { isGitResource, type GitResource, type LocalResource } from '../core/resource/types.ts';
import type { Repo, ThreadQuestion, QuestionStatus } from './types.ts';

// Create a managed runtime with BunContext
const runtime = ManagedRuntime.make(BunContext.layer);

// Create a runtime that initializes core services once
let cachedServices: CoreServices | null = null;

const getServices = async (): Promise<CoreServices> => {
	if (cachedServices) return cachedServices;
	cachedServices = await runtime.runPromise(initializeCoreServices);
	return cachedServices;
};

// Session state for persistent chat
let currentSession: SessionState | null = null;
let currentSessionResources: string[] = [];

// Track current server for cancellation
let currentServer: { close: () => void } | null = null;

/**
 * Convert ResourceDefinition to legacy Repo type for TUI compatibility
 */
const resourceToRepo = (r: GitResource): Repo => ({
	name: r.name,
	url: r.url,
	branch: r.branch,
	specialNotes: r.specialNotes,
	searchPath: r.searchPath
});

export const services = {
	/**
	 * Get all resources as Repos (only git resources for now)
	 */
	getRepos: async (): Promise<Repo[]> => {
		const core = await getServices();
		const resources = await Effect.runPromise(core.config.getResources());
		// Only return git resources as Repos (local resources don't fit the Repo interface)
		return resources.filter(isGitResource).map(resourceToRepo);
	},

	/**
	 * Add a git resource (as Repo)
	 */
	addRepo: async (repo: Repo): Promise<Repo> => {
		const core = await getServices();
		const resource: GitResource = {
			type: 'git',
			name: repo.name,
			url: repo.url,
			branch: repo.branch,
			specialNotes: repo.specialNotes,
			searchPath: repo.searchPath
		};
		await runtime.runPromise(core.config.addResource(resource));
		return repo;
	},

	/**
	 * Add a local resource
	 */
	addLocalResource: async (resource: {
		name: string;
		path: string;
		specialNotes?: string;
	}): Promise<void> => {
		const core = await getServices();
		const localResource: LocalResource = {
			type: 'local',
			name: resource.name,
			path: resource.path,
			...(resource.specialNotes && { specialNotes: resource.specialNotes })
		};
		await runtime.runPromise(core.config.addResource(localResource));
	},

	/**
	 * Remove a resource by name
	 */
	removeRepo: async (name: string): Promise<void> => {
		const core = await getServices();
		await runtime.runPromise(core.config.removeResource(name));
	},

	/**
	 * Get current model config
	 */
	getModel: async (): Promise<{ provider: string; model: string }> => {
		const core = await getServices();
		return runtime.runPromise(core.config.getModel());
	},

	/**
	 * Update model config
	 */
	updateModel: async (
		provider: string,
		model: string
	): Promise<{ provider: string; model: string }> => {
		const core = await getServices();
		return runtime.runPromise(core.config.updateModel({ provider, model }));
	},

	/**
	 * Spawn OpenCode TUI for resources
	 */
	spawnTui: async (resourceNames: string[]): Promise<void> => {
		const core = await getServices();
		await Effect.runPromise(
			Effect.gen(function* () {
				const resourceInfos = yield* getResourceInfos(core.resources, resourceNames);
				const collection = yield* core.collections.ensure(resourceNames, { quiet: false });
				yield* core.agent.spawnTui({ collection, resources: resourceInfos });
			}).pipe(Effect.provide(BunContext.layer))
		);
	},

	/**
	 * Create a persistent session for chat
	 */
	createSession: async (resourceNames: string[]): Promise<SessionState> => {
		const core = await getServices();

		// End existing session if resources changed
		if (currentSession && currentSessionResources.join(',') !== resourceNames.sort().join(',')) {
			await Effect.runPromise(core.agent.endSession(currentSession));
			currentSession = null;
		}

		if (!currentSession) {
			currentSession = await Effect.runPromise(
				Effect.gen(function* () {
					const resourceInfos = yield* getResourceInfos(core.resources, resourceNames);
					const collection = yield* core.collections.ensure(resourceNames, { quiet: true });
					return yield* core.agent.createSession({ collection, resources: resourceInfos });
				}).pipe(Effect.provide(BunContext.layer))
			);
			currentSessionResources = resourceNames.sort();
		}

		return currentSession;
	},

	/**
	 * Ask a question in an existing session (preserves context)
	 */
	askInSession: async (
		session: SessionState,
		question: string,
		onChunkUpdate: (update: ChunkUpdate) => void
	): Promise<BtcaChunk[]> => {
		const core = await getServices();
		return Effect.runPromise(
			Effect.gen(function* () {
				const eventStream = yield* core.agent.askInSession({ session, question });
				const { stream: chunkStream, getChunks } = streamToChunks(eventStream);
				yield* Stream.runForEach(chunkStream, (update) => Effect.sync(() => onChunkUpdate(update)));
				return getChunks();
			})
		);
	},

	/**
	 * End a session and cleanup
	 */
	endSession: async (session: SessionState): Promise<void> => {
		const core = await getServices();
		await Effect.runPromise(core.agent.endSession(session));
		if (currentSession === session) {
			currentSession = null;
			currentSessionResources = [];
		}
	},

	/**
	 * Single-shot question across multiple resources (creates and destroys session)
	 * @param threadContext - Optional conversation history to pass to the agent
	 */
	askQuestion: async (
		resourceNames: string[],
		question: string,
		onChunkUpdate: (update: ChunkUpdate) => void,
		threadContext?: string
	): Promise<BtcaChunk[]> => {
		const core = await getServices();
		return Effect.runPromise(
			Effect.gen(function* () {
				const resourceInfos = yield* getResourceInfos(core.resources, resourceNames);
				const collection = yield* core.collections.ensure(resourceNames, { quiet: true });
				const eventStream = yield* core.agent.ask({
					collection,
					resources: resourceInfos,
					question,
					threadContext
				});
				const { stream: chunkStream, getChunks } = streamToChunks(eventStream);
				yield* Stream.runForEach(chunkStream, (update) => Effect.sync(() => onChunkUpdate(update)));
				return getChunks();
			}).pipe(Effect.provide(BunContext.layer))
		);
	},

	/**
	 * Legacy: single-tech question for backwards compatibility
	 */
	askQuestionLegacy: async (
		tech: string,
		question: string,
		onChunkUpdate: (update: ChunkUpdate) => void
	): Promise<BtcaChunk[]> => {
		return services.askQuestion([tech], question, onChunkUpdate);
	},

	// ===== Thread Management =====

	/**
	 * Create a new thread and return its ID
	 */
	createThread: async (): Promise<string> => {
		const core = await getServices();
		const thread = await runtime.runPromise(core.threads.create());
		return thread.id;
	},

	/**
	 * Persist a question to a thread
	 * @returns The question ID
	 */
	persistQuestion: async (
		threadId: string,
		question: {
			resources: string[];
			prompt: string;
			answer: string;
			status: QuestionStatus;
		}
	): Promise<string> => {
		const core = await getServices();
		const modelConfig = await runtime.runPromise(core.config.getModel());
		const q = await runtime.runPromise(
			core.threads.appendQuestion(threadId, {
				resources: question.resources,
				provider: modelConfig.provider,
				model: modelConfig.model,
				prompt: question.prompt,
				answer: question.answer,
				status: question.status,
				metadata: {
					filesRead: [],
					searchesPerformed: [],
					tokenUsage: { input: 0, output: 0 },
					durationMs: 0
				}
			})
		);
		return q.id;
	},

	/**
	 * Update a question's answer
	 */
	updateQuestionAnswer: async (questionId: string, answer: string): Promise<void> => {
		const core = await getServices();
		await runtime.runPromise(core.threads.updateQuestion(questionId, { answer }));
	},

	/**
	 * Update a question's status (e.g., to 'canceled')
	 */
	updateQuestionStatus: async (questionId: string, status: QuestionStatus): Promise<void> => {
		const core = await getServices();
		await runtime.runPromise(core.threads.updateQuestion(questionId, { status }));
	},

	/**
	 * Build thread context from question history for passing to the agent
	 */
	buildThreadContext: (questions: ThreadQuestion[]): string => {
		if (questions.length === 0) return '';

		const history = questions
			.map((q, i) => {
				const statusNote = q.status === 'canceled' ? ' - CANCELED' : '';
				return `[Q${i + 1}] ${q.prompt}\n[A${i + 1}${statusNote}] ${q.answer}`;
			})
			.join('\n\n');

		return `=== CONVERSATION HISTORY ===\n${history}\n=== END HISTORY ===`;
	},

	// ===== Cancel Support =====

	/**
	 * Set the current server reference (for cancellation)
	 */
	setCurrentServer: (server: { close: () => void } | null): void => {
		currentServer = server;
	},

	/**
	 * Cancel the current request by closing the server
	 */
	cancelCurrentRequest: async (): Promise<void> => {
		if (currentServer) {
			currentServer.close();
			currentServer = null;
		}
	}
};

export type Services = typeof services;
