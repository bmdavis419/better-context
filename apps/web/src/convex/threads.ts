import { internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import { AnalyticsEvents } from './analyticsEvents';
import {
	getAuthenticatedInstanceResult,
	requireThreadOwnershipResult,
	unwrapAuthResult
} from './authHelpers';

// Shared validators
const threadValidator = v.object({
	_id: v.id('threads'),
	_creationTime: v.number(),
	instanceId: v.id('instances'),
	projectId: v.optional(v.id('projects')),
	title: v.optional(v.string()),
	createdAt: v.number(),
	lastActivityAt: v.number()
});

const threadWithStreamingValidator = v.object({
	_id: v.id('threads'),
	_creationTime: v.number(),
	instanceId: v.id('instances'),
	projectId: v.optional(v.id('projects')),
	title: v.optional(v.string()),
	createdAt: v.number(),
	lastActivityAt: v.number(),
	isStreaming: v.boolean()
});

/**
 * List threads for the authenticated user's instance, optionally filtered by project
 */
export const list = query({
	args: {
		projectId: v.optional(v.id('projects'))
	},
	returns: v.array(threadWithStreamingValidator),
	handler: async (ctx, args) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));

		let threads;
		if (args.projectId) {
			threads = await ctx.db
				.query('threads')
				.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
				.collect();
			threads = threads.filter((t) => t.instanceId === instance._id);
		} else {
			threads = await ctx.db
				.query('threads')
				.withIndex('by_instance', (q) => q.eq('instanceId', instance._id))
				.collect();
		}

		const activeStreamSessions = await ctx.db
			.query('streamSessions')
			.withIndex('by_status', (q) => q.eq('status', 'streaming'))
			.collect();

		const streamingThreadIds = new Set(activeStreamSessions.map((s) => s.threadId.toString()));

		const threadsWithStreaming = threads.map((thread) => ({
			...thread,
			isStreaming: streamingThreadIds.has(thread._id.toString())
		}));

		return threadsWithStreaming.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	}
});

// Message content validator (same as schema)
const btcaChunkValidator = v.union(
	v.object({
		type: v.literal('text'),
		id: v.string(),
		text: v.string()
	}),
	v.object({
		type: v.literal('reasoning'),
		id: v.string(),
		text: v.string()
	}),
	v.object({
		type: v.literal('tool'),
		id: v.string(),
		toolName: v.string(),
		state: v.union(v.literal('pending'), v.literal('running'), v.literal('completed'))
	}),
	v.object({
		type: v.literal('file'),
		id: v.string(),
		filePath: v.string()
	})
);

const messageContentValidator = v.union(
	v.string(),
	v.object({
		type: v.literal('chunks'),
		chunks: v.array(btcaChunkValidator)
	})
);

const messageValidator = v.object({
	_id: v.id('messages'),
	_creationTime: v.number(),
	threadId: v.id('threads'),
	role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
	content: messageContentValidator,
	resources: v.optional(v.array(v.string())),
	canceled: v.optional(v.boolean()),
	createdAt: v.number()
});

/**
 * Get a thread with its messages (requires ownership)
 */
export const getWithMessages = query({
	args: { threadId: v.id('threads') },
	returns: v.union(
		v.null(),
		v.object({
			_id: v.id('threads'),
			_creationTime: v.number(),
			instanceId: v.id('instances'),
			projectId: v.optional(v.id('projects')),
			title: v.optional(v.string()),
			createdAt: v.number(),
			lastActivityAt: v.number(),
			messages: v.array(messageValidator),
			resources: v.array(v.string()),
			threadResources: v.array(v.string()),
			activeStream: v.union(
				v.null(),
				v.object({
					sessionId: v.string(),
					messageId: v.id('messages'),
					startedAt: v.number()
				})
			)
		})
	),
	handler: async (ctx, args) => {
		const { thread } = await unwrapAuthResult(
			await requireThreadOwnershipResult(ctx, args.threadId)
		);

		const messages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		const threadResources = await ctx.db
			.query('threadResources')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		const activeStreamSession = await ctx.db
			.query('streamSessions')
			.withIndex('by_thread_and_status', (q) =>
				q.eq('threadId', args.threadId).eq('status', 'streaming')
			)
			.first();

		return {
			...thread,
			messages: messages.sort((a, b) => a.createdAt - b.createdAt),
			resources: threadResources.map((r) => r.resourceName),
			threadResources: threadResources.map((r) => r.resourceName),
			activeStream: activeStreamSession
				? {
						sessionId: activeStreamSession.sessionId,
						messageId: activeStreamSession.messageId,
						startedAt: activeStreamSession.startedAt
					}
				: null
		};
	}
});

/**
 * Create a thread for the authenticated user's instance
 */
export const create = mutation({
	args: {
		title: v.optional(v.string()),
		projectId: v.optional(v.id('projects'))
	},
	returns: v.id('threads'),
	handler: async (ctx, args) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));

		const threadId = await ctx.db.insert('threads', {
			instanceId: instance._id,
			projectId: args.projectId,
			title: args.title,
			createdAt: Date.now(),
			lastActivityAt: Date.now()
		});

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.THREAD_CREATED,
			properties: {
				instanceId: instance._id,
				threadId
			}
		});

		return threadId;
	}
});

/**
 * Remove a thread owned by the authenticated user
 */
export const remove = mutation({
	args: { threadId: v.id('threads') },
	returns: v.null(),
	handler: async (ctx, args) => {
		const { thread, instance } = await unwrapAuthResult(
			await requireThreadOwnershipResult(ctx, args.threadId)
		);

		const messages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		for (const message of messages) {
			await ctx.db.delete(message._id);
		}

		const threadResources = await ctx.db
			.query('threadResources')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		for (const resource of threadResources) {
			await ctx.db.delete(resource._id);
		}

		await ctx.db.delete(args.threadId);

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.THREAD_DELETED,
			properties: {
				instanceId: thread.instanceId,
				threadId: args.threadId,
				messageCount: messages.length
			}
		});

		return null;
	}
});

/**
 * Clear messages from a thread owned by the authenticated user
 */
export const clearMessages = mutation({
	args: { threadId: v.id('threads') },
	returns: v.null(),
	handler: async (ctx, args) => {
		const { thread, instance } = await unwrapAuthResult(
			await requireThreadOwnershipResult(ctx, args.threadId)
		);

		const messages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		for (const message of messages) {
			await ctx.db.delete(message._id);
		}

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.THREAD_CLEARED,
			properties: {
				instanceId: thread.instanceId,
				threadId: args.threadId,
				messageCount: messages.length
			}
		});

		return null;
	}
});

/**
 * Update thread title (requires ownership)
 */
export const updateTitle = mutation({
	args: {
		threadId: v.id('threads'),
		title: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await unwrapAuthResult(await requireThreadOwnershipResult(ctx, args.threadId));
		await ctx.db.patch(args.threadId, { title: args.title });
		return null;
	}
});

/**
 * Internal mutation to update thread title (for use by internal actions like title generation)
 */
export const updateTitleInternal = internalMutation({
	args: {
		threadId: v.id('threads'),
		title: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.threadId, { title: args.title });
		return null;
	}
});
