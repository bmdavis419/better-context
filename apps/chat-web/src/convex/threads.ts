import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const list = query({
	args: { instanceId: v.id('instances') },
	handler: async (ctx, args) => {
		const threads = await ctx.db
			.query('threads')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();

		return threads.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	}
});

export const getWithMessages = query({
	args: { threadId: v.id('threads') },
	handler: async (ctx, args) => {
		const thread = await ctx.db.get(args.threadId);
		if (!thread) return null;

		const messages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		const threadResources = await ctx.db
			.query('threadResources')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		return {
			...thread,
			messages: messages.sort((a, b) => a.createdAt - b.createdAt),
			resources: threadResources.map((r) => r.resourceName),
			threadResources: threadResources.map((r) => r.resourceName)
		};
	}
});

export const create = mutation({
	args: {
		instanceId: v.id('instances'),
		title: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert('threads', {
			instanceId: args.instanceId,
			title: args.title,
			createdAt: Date.now(),
			lastActivityAt: Date.now()
		});
	}
});

export const remove = mutation({
	args: { threadId: v.id('threads') },
	handler: async (ctx, args) => {
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
	}
});

export const clearMessages = mutation({
	args: { threadId: v.id('threads') },
	handler: async (ctx, args) => {
		const messages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		for (const message of messages) {
			await ctx.db.delete(message._id);
		}
	}
});
