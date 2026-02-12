import { v } from 'convex/values';

import { internal } from './_generated/api';
import { mutation, query } from './_generated/server';
import {
	requireMessageOwnershipResult,
	requireThreadOwnershipResult,
	unwrapAuthResult
} from './authHelpers';
import { WebValidationError, type WebError } from '../lib/result/errors';

const throwMessageError = (error: WebError): never => {
	throw error;
};

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
 * Add a user message to a thread (requires ownership)
 */
export const addUserMessage = mutation({
	args: {
		threadId: v.id('threads'),
		content: v.string(),
		resources: v.array(v.string())
	},
	returns: v.id('messages'),
	handler: async (ctx, args) => {
		const { thread } = await unwrapAuthResult(
			await requireThreadOwnershipResult(ctx, args.threadId)
		);

		// Check if thread needs a title generated (first message)
		const shouldGenerateTitle = !thread.title;

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

		// Schedule title generation for first message
		if (shouldGenerateTitle) {
			await ctx.scheduler.runAfter(0, internal.threadTitle.generateAndUpdateTitle, {
				threadId: args.threadId,
				firstMessage: args.content
			});
		}

		return messageId;
	}
});

/**
 * Add an assistant message to a thread (requires ownership)
 */
export const addAssistantMessage = mutation({
	args: {
		threadId: v.id('threads'),
		content: messageContentValidator,
		canceled: v.optional(v.boolean())
	},
	returns: v.id('messages'),
	handler: async (ctx, args) => {
		await unwrapAuthResult(await requireThreadOwnershipResult(ctx, args.threadId));

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
 * Add a system message to a thread (requires ownership)
 */
export const addSystemMessage = mutation({
	args: {
		threadId: v.id('threads'),
		content: v.string()
	},
	returns: v.id('messages'),
	handler: async (ctx, args) => {
		await unwrapAuthResult(await requireThreadOwnershipResult(ctx, args.threadId));

		return await ctx.db.insert('messages', {
			threadId: args.threadId,
			role: 'system',
			content: args.content,
			createdAt: Date.now()
		});
	}
});

// Message validator for return types
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
 * Get all messages for a thread (requires ownership)
 */
export const getByThread = query({
	args: { threadId: v.id('threads') },
	returns: v.array(messageValidator),
	handler: async (ctx, args) => {
		await unwrapAuthResult(await requireThreadOwnershipResult(ctx, args.threadId));

		const messages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		return messages.sort((a, b) => a.createdAt - b.createdAt);
	}
});

/**
 * Update an assistant message (requires ownership)
 */
export const updateAssistantMessage = mutation({
	args: {
		messageId: v.id('messages'),
		content: messageContentValidator
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await unwrapAuthResult(await requireMessageOwnershipResult(ctx, args.messageId));
		await ctx.db.patch(args.messageId, { content: args.content });
		return null;
	}
});

/**
 * Mark an assistant message as canceled (requires ownership)
 */
export const markCanceled = mutation({
	args: { messageId: v.id('messages') },
	returns: v.null(),
	handler: async (ctx, args) => {
		await unwrapAuthResult(await requireMessageOwnershipResult(ctx, args.messageId));
		await ctx.db.patch(args.messageId, { canceled: true });
		return null;
	}
});

/**
 * Delete a message and all messages after it in the thread (requires ownership)
 */
export const deleteMessageAndAfter = mutation({
	args: {
		threadId: v.id('threads'),
		messageId: v.id('messages')
	},
	returns: v.object({ deletedCount: v.number() }),
	handler: async (ctx, args) => {
		await unwrapAuthResult(await requireThreadOwnershipResult(ctx, args.threadId));

		const targetMessage = await ctx.db.get(args.messageId);
		if (!targetMessage || targetMessage.threadId !== args.threadId) {
			return throwMessageError(
				new WebValidationError({ message: 'Message not found in thread', field: 'messageId' })
			);
		}

		const allMessages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
			.collect();

		const messagesToDelete = allMessages.filter((m) => m.createdAt >= targetMessage.createdAt);

		for (const message of messagesToDelete) {
			await ctx.db.delete(message._id);
		}

		return { deletedCount: messagesToDelete.length };
	}
});
