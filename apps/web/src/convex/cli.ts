'use node';

import { v } from 'convex/values';

import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { action } from './_generated/server';
import { instances } from './apiHelpers';
import type { ApiKeyValidationResult } from './clerkApiKeys';

const instanceActions = instances.actions;

// ─────────────────────────────────────────────────────────────────────────────
// Actions (public endpoints)
// Internal queries are in cliInternal.ts (can't use Node.js runtime)
// ─────────────────────────────────────────────────────────────────────────────

type StatusResult =
	| { ok: false; error: string }
	| {
			ok: true;
			instance: {
				_id: string;
				state: string;
				serverUrl: string | undefined;
				btcaVersion: string | undefined;
				subscriptionPlan: string | undefined;
			};
			project?: {
				_id: string;
				name: string;
				model: string | undefined;
				isDefault: boolean;
				createdAt: number;
			};
	  };

/**
 * Get instance status for CLI
 */
export const getInstanceStatus = action({
	args: {
		apiKey: v.string(),
		project: v.optional(v.string())
	},
	handler: async (ctx, args): Promise<StatusResult> => {
		const { apiKey, project: projectName } = args;

		// Validate API key with Clerk
		const validation = (await ctx.runAction(api.clerkApiKeys.validate, {
			apiKey
		})) as ApiKeyValidationResult;
		if (!validation.valid) {
			return { ok: false, error: validation.error };
		}

		const instanceId = validation.instanceId;

		// Get instance
		const instance = await ctx.runQuery(instances.internalQueries.getInternal, { id: instanceId });
		if (!instance) {
			return { ok: false, error: 'Instance not found' };
		}

		// Get project if specified
		let project: Doc<'projects'> | null = null;
		if (projectName) {
			project = await ctx.runQuery(internal.projects.getByInstanceAndName, {
				instanceId,
				name: projectName
			});
		}

		return {
			ok: true,
			instance: {
				_id: instance._id as string,
				state: instance.state,
				serverUrl: instance.serverUrl,
				btcaVersion: instance.btcaVersion,
				subscriptionPlan: instance.subscriptionPlan
			},
			project: project
				? {
						_id: project._id as string,
						name: project.name,
						model: project.model,
						isDefault: project.isDefault,
						createdAt: project.createdAt
					}
				: undefined
		};
	}
});

type WakeResult = { ok: false; error: string } | { ok: true; serverUrl: string };

/**
 * Wake the sandbox for CLI
 */
export const wakeInstance = action({
	args: {
		apiKey: v.string()
	},
	handler: async (ctx, args): Promise<WakeResult> => {
		const { apiKey } = args;

		// Validate API key with Clerk
		const validation = (await ctx.runAction(api.clerkApiKeys.validate, {
			apiKey
		})) as ApiKeyValidationResult;
		if (!validation.valid) {
			return { ok: false, error: validation.error };
		}

		const instanceId = validation.instanceId;

		// Get instance
		const instance = await ctx.runQuery(instances.internalQueries.getInternal, { id: instanceId });
		if (!instance) {
			return { ok: false, error: 'Instance not found' };
		}

		if (!instance.sandboxId) {
			return { ok: false, error: 'Instance does not have a sandbox' };
		}

		// Wake it if not running
		if (instance.state !== 'running' || !instance.serverUrl) {
			try {
				const result = await ctx.runAction(instanceActions.wake, { instanceId });
				return { ok: true, serverUrl: result.serverUrl };
			} catch (err) {
				return {
					ok: false,
					error: err instanceof Error ? err.message : 'Failed to wake sandbox'
				};
			}
		}

		return { ok: true, serverUrl: instance.serverUrl };
	}
});

type ProjectsResult =
	| { ok: false; error: string }
	| {
			ok: true;
			projects: Array<{
				_id: string;
				name: string;
				model: string | undefined;
				isDefault: boolean;
				createdAt: number;
			}>;
	  };

/**
 * List projects for CLI
 */
export const listProjects = action({
	args: {
		apiKey: v.string()
	},
	handler: async (ctx, args): Promise<ProjectsResult> => {
		const { apiKey } = args;

		// Validate API key with Clerk
		const validation = (await ctx.runAction(api.clerkApiKeys.validate, {
			apiKey
		})) as ApiKeyValidationResult;
		if (!validation.valid) {
			return { ok: false, error: validation.error };
		}

		const instanceId = validation.instanceId;

		// Get projects
		const projects = await ctx.runQuery(internal.cliInternal.listProjectsInternal, { instanceId });

		return { ok: true, projects };
	}
});

type ThreadsResult =
	| { ok: false; error: string }
	| {
			ok: true;
			threads: Array<{
				_id: string;
				title: string | undefined;
				createdAt: number;
				lastActivityAt: number;
			}>;
	  };

/**
 * List threads for CLI
 */
export const listThreads = action({
	args: {
		apiKey: v.string(),
		project: v.optional(v.string())
	},
	handler: async (ctx, args): Promise<ThreadsResult> => {
		const { apiKey, project: projectName } = args;

		// Validate API key with Clerk
		const validation = (await ctx.runAction(api.clerkApiKeys.validate, {
			apiKey
		})) as ApiKeyValidationResult;
		if (!validation.valid) {
			return { ok: false, error: validation.error };
		}

		const instanceId = validation.instanceId;

		// Get threads
		const threads = await ctx.runQuery(internal.cliInternal.listThreadsInternal, {
			instanceId,
			projectName
		});

		return { ok: true, threads };
	}
});

type ThreadResult =
	| { ok: false; error: string }
	| {
			ok: true;
			thread: {
				_id: string;
				title: string | undefined;
				createdAt: number;
				lastActivityAt: number;
			};
			messages: Array<{
				_id: string;
				threadId: string;
				role: string;
				content: string;
				resources: string[] | undefined;
				createdAt: number;
			}>;
	  };

/**
 * Get thread with messages for CLI
 */
export const getThread = action({
	args: {
		apiKey: v.string(),
		threadId: v.string()
	},
	handler: async (ctx, args): Promise<ThreadResult> => {
		const { apiKey, threadId } = args;

		// Validate API key with Clerk
		const validation = (await ctx.runAction(api.clerkApiKeys.validate, {
			apiKey
		})) as ApiKeyValidationResult;
		if (!validation.valid) {
			return { ok: false, error: validation.error };
		}

		const instanceId = validation.instanceId;

		// Get thread
		const result = await ctx.runQuery(internal.cliInternal.getThreadInternal, {
			instanceId,
			threadId
		});

		if (!result) {
			return { ok: false, error: 'Thread not found' };
		}

		return { ok: true, thread: result.thread, messages: result.messages };
	}
});

type QuestionsResult =
	| { ok: false; error: string }
	| {
			ok: true;
			questions: Array<{
				_id: string;
				projectId: string;
				question: string;
				resources: string[];
				answer: string;
				createdAt: number;
			}>;
	  };

/**
 * List MCP questions for CLI
 */
export const listQuestions = action({
	args: {
		apiKey: v.string(),
		project: v.string()
	},
	handler: async (ctx, args): Promise<QuestionsResult> => {
		const { apiKey, project: projectName } = args;

		// Validate API key with Clerk
		const validation = (await ctx.runAction(api.clerkApiKeys.validate, {
			apiKey
		})) as ApiKeyValidationResult;
		if (!validation.valid) {
			return { ok: false, error: validation.error };
		}

		const instanceId = validation.instanceId;

		// Get project
		const project = await ctx.runQuery(internal.projects.getByInstanceAndName, {
			instanceId,
			name: projectName
		});

		if (!project) {
			return { ok: false, error: `Project "${projectName}" not found` };
		}

		// Get questions
		const questions = await ctx.runQuery(internal.cliInternal.listQuestionsInternal, {
			projectId: project._id
		});

		return { ok: true, questions };
	}
});
