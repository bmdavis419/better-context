import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/**
 * Create a new thread
 */
export const create = mutation({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const now = Date.now();
		return await ctx.db.insert('threads', {
			userId: args.userId,
			createdAt: now,
			lastActivityAt: now
		});
	}
});

/**
 * List all threads for a user (most recent first)
 */
export const list = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const threads = await ctx.db
			.query('threads')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.collect();

		// Sort by lastActivityAt descending
		return threads.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	}
});

/**
 * Get a single thread by ID
 */
export const get = query({
	args: { threadId: v.id('threads') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.threadId);
	}
});

/**
 * Get a thread with its messages
 */
export const getWithMessages = query({
	args: { threadId: v.id('threads') },
	handler: async (ctx, args) => {
		const thread = await ctx.db.get(args.threadId);
		if (!thread) return null;

		const messages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		// Get thread resources
		const threadResources = await ctx.db
			.query('threadResources')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		return {
			...thread,
			messages: messages.sort((a, b) => a.createdAt - b.createdAt),
			threadResources: threadResources.map((tr) => tr.resourceName)
		};
	}
});

/**
 * Set sandbox ID for a thread
 */
export const setSandboxId = mutation({
	args: {
		threadId: v.id('threads'),
		sandboxId: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.threadId, {
			sandboxId: args.sandboxId,
			lastActivityAt: Date.now()
		});
	}
});

/**
 * Update thread title
 */
export const updateTitle = mutation({
	args: {
		threadId: v.id('threads'),
		title: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.threadId, { title: args.title });
	}
});

/**
 * Touch thread (update lastActivityAt)
 */
export const touch = mutation({
	args: { threadId: v.id('threads') },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.threadId, { lastActivityAt: Date.now() });
	}
});

/**
 * Delete a thread and all its messages
 */
export const remove = mutation({
	args: { threadId: v.id('threads') },
	handler: async (ctx, args) => {
		// Delete all messages
		const messages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		for (const message of messages) {
			await ctx.db.delete(message._id);
		}

		// Delete thread resources
		const threadResources = await ctx.db
			.query('threadResources')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		for (const tr of threadResources) {
			await ctx.db.delete(tr._id);
		}

		// Delete the thread
		await ctx.db.delete(args.threadId);
	}
});

/**
 * Get all threads with sandboxes for a user
 * Used to find other sandboxes to stop when starting a new one
 */
export const listWithSandbox = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		const threads = await ctx.db
			.query('threads')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.filter((q) => q.neq(q.field('sandboxId'), undefined))
			.collect();

		return threads;
	}
});

/**
 * Clear all messages in a thread (but keep the thread)
 */
export const clearMessages = mutation({
	args: { threadId: v.id('threads') },
	handler: async (ctx, args) => {
		// Delete all messages
		const messages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		for (const message of messages) {
			await ctx.db.delete(message._id);
		}

		// Clear thread resources
		const threadResources = await ctx.db
			.query('threadResources')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		for (const tr of threadResources) {
			await ctx.db.delete(tr._id);
		}

		// Update thread activity
		await ctx.db.patch(args.threadId, { lastActivityAt: Date.now() });
	}
});
