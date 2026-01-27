import { internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import { AnalyticsEvents } from './analyticsEvents';
import { getAuthenticatedInstance, requireThreadOwnership } from './authHelpers';

/**
 * List threads for the authenticated user's instance, optionally filtered by project
 */
export const list = query({
	args: {
		projectId: v.optional(v.id('projects'))
	},
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);

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
			.filter((q) => q.eq(q.field('status'), 'streaming'))
			.collect();

		const streamingThreadIds = new Set(activeStreamSessions.map((s) => s.threadId.toString()));

		const threadsWithStreaming = threads.map((thread) => ({
			...thread,
			isStreaming: streamingThreadIds.has(thread._id.toString())
		}));

		return threadsWithStreaming.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	}
});

/**
 * Get a thread with its messages (requires ownership)
 */
export const getWithMessages = query({
	args: { threadId: v.id('threads') },
	handler: async (ctx, args) => {
		const { thread } = await requireThreadOwnership(ctx, args.threadId);

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
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.filter((q) => q.eq(q.field('status'), 'streaming'))
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
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);

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
	handler: async (ctx, args) => {
		const { thread, instance } = await requireThreadOwnership(ctx, args.threadId);

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
	}
});

/**
 * Clear messages from a thread owned by the authenticated user
 */
export const clearMessages = mutation({
	args: { threadId: v.id('threads') },
	handler: async (ctx, args) => {
		const { thread, instance } = await requireThreadOwnership(ctx, args.threadId);

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
	handler: async (ctx, args) => {
		await requireThreadOwnership(ctx, args.threadId);
		await ctx.db.patch(args.threadId, { title: args.title });
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
	handler: async (ctx, args) => {
		await ctx.db.patch(args.threadId, { title: args.title });
	}
});
