import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// BtcaChunk validator (same as in schema)
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

// Message content validator
const messageContentValidator = v.union(
	v.string(),
	v.object({
		type: v.literal('chunks'),
		chunks: v.array(btcaChunkValidator)
	})
);

/**
 * Add a user message to a thread
 */
export const addUserMessage = mutation({
	args: {
		threadId: v.id('threads'),
		content: v.string(),
		resources: v.array(v.string())
	},
	handler: async (ctx, args) => {
		// Add the message
		const messageId = await ctx.db.insert('messages', {
			threadId: args.threadId,
			role: 'user',
			content: args.content,
			resources: args.resources,
			createdAt: Date.now()
		});

		// Update thread resources (add new ones)
		const existingResources = await ctx.db
			.query('threadResources')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		const existingNames = new Set(existingResources.map((r) => r.resourceName));

		for (const resourceName of args.resources) {
			if (!existingNames.has(resourceName)) {
				await ctx.db.insert('threadResources', {
					threadId: args.threadId,
					resourceName
				});
			}
		}

		// Touch the thread
		await ctx.db.patch(args.threadId, { lastActivityAt: Date.now() });

		return messageId;
	}
});

/**
 * Add an assistant message to a thread
 */
export const addAssistantMessage = mutation({
	args: {
		threadId: v.id('threads'),
		content: messageContentValidator,
		canceled: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const messageId = await ctx.db.insert('messages', {
			threadId: args.threadId,
			role: 'assistant',
			content: args.content,
			canceled: args.canceled,
			createdAt: Date.now()
		});

		// Touch the thread
		await ctx.db.patch(args.threadId, { lastActivityAt: Date.now() });

		return messageId;
	}
});

/**
 * Add a system message to a thread
 */
export const addSystemMessage = mutation({
	args: {
		threadId: v.id('threads'),
		content: v.string()
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert('messages', {
			threadId: args.threadId,
			role: 'system',
			content: args.content,
			createdAt: Date.now()
		});
	}
});

/**
 * Get all messages for a thread
 */
export const getByThread = query({
	args: { threadId: v.id('threads') },
	handler: async (ctx, args) => {
		const messages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		return messages.sort((a, b) => a.createdAt - b.createdAt);
	}
});

/**
 * Update an assistant message (used for streaming updates)
 */
export const updateAssistantMessage = mutation({
	args: {
		messageId: v.id('messages'),
		content: messageContentValidator
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.messageId, { content: args.content });
	}
});

/**
 * Mark an assistant message as canceled
 */
export const markCanceled = mutation({
	args: { messageId: v.id('messages') },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.messageId, { canceled: true });
	}
});
