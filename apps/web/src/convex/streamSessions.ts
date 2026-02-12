import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireThreadOwnershipResult, unwrapAuthResult } from './authHelpers';

// Stream session validator
const streamSessionValidator = v.object({
	_id: v.id('streamSessions'),
	_creationTime: v.number(),
	threadId: v.id('threads'),
	messageId: v.id('messages'),
	sessionId: v.string(),
	status: v.union(v.literal('streaming'), v.literal('done'), v.literal('error')),
	startedAt: v.number(),
	completedAt: v.optional(v.number()),
	error: v.optional(v.string())
});

/**
 * Create a stream session for a thread (requires ownership)
 */
export const create = mutation({
	args: {
		threadId: v.id('threads'),
		messageId: v.id('messages'),
		sessionId: v.string()
	},
	returns: v.id('streamSessions'),
	handler: async (ctx, args) => {
		await unwrapAuthResult(await requireThreadOwnershipResult(ctx, args.threadId));

		const existing = await ctx.db
			.query('streamSessions')
			.withIndex('by_thread_and_status', (q) =>
				q.eq('threadId', args.threadId).eq('status', 'streaming')
			)
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, {
				status: 'error',
				error: 'Superseded by new stream',
				completedAt: Date.now()
			});
		}

		return await ctx.db.insert('streamSessions', {
			threadId: args.threadId,
			messageId: args.messageId,
			sessionId: args.sessionId,
			status: 'streaming',
			startedAt: Date.now()
		});
	}
});

/**
 * Complete a stream session by session ID
 * Note: This is typically called by internal server processes, uses session ID for auth
 */
export const complete = mutation({
	args: {
		sessionId: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const session = await ctx.db
			.query('streamSessions')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.first();

		if (session && session.status === 'streaming') {
			await ctx.db.patch(session._id, {
				status: 'done',
				completedAt: Date.now()
			});
		}
		return null;
	}
});

/**
 * Fail a stream session by session ID
 * Note: This is typically called by internal server processes, uses session ID for auth
 */
export const fail = mutation({
	args: {
		sessionId: v.string(),
		error: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const session = await ctx.db
			.query('streamSessions')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.first();

		if (session && session.status === 'streaming') {
			await ctx.db.patch(session._id, {
				status: 'error',
				error: args.error,
				completedAt: Date.now()
			});
		}
		return null;
	}
});

/**
 * Get active stream session for a thread (requires ownership)
 */
export const getActiveForThread = query({
	args: {
		threadId: v.id('threads')
	},
	returns: v.union(v.null(), streamSessionValidator),
	handler: async (ctx, args) => {
		await unwrapAuthResult(await requireThreadOwnershipResult(ctx, args.threadId));

		return await ctx.db
			.query('streamSessions')
			.withIndex('by_thread_and_status', (q) =>
				q.eq('threadId', args.threadId).eq('status', 'streaming')
			)
			.first();
	}
});

/**
 * Get stream session by session ID
 * Note: This uses the session ID itself as the auth mechanism
 */
export const getBySessionId = query({
	args: {
		sessionId: v.string()
	},
	returns: v.union(v.null(), streamSessionValidator),
	handler: async (ctx, args) => {
		return await ctx.db
			.query('streamSessions')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.first();
	}
});

/**
 * Cleanup old stream sessions (internal maintenance)
 */
export const cleanupOld = mutation({
	args: {},
	returns: v.object({ deleted: v.number() }),
	handler: async (ctx) => {
		const oneHourAgo = Date.now() - 60 * 60 * 1000;

		// Use index to find streaming sessions, then filter by time
		const streamingSessions = await ctx.db
			.query('streamSessions')
			.withIndex('by_status', (q) => q.eq('status', 'streaming'))
			.collect();

		const oldStreamingSessions = streamingSessions.filter((s) => s.startedAt < oneHourAgo);

		// Get completed/error sessions that are old
		const doneSessions = await ctx.db
			.query('streamSessions')
			.withIndex('by_status', (q) => q.eq('status', 'done'))
			.collect();
		const oldDoneSessions = doneSessions.filter((s) => s.completedAt && s.completedAt < oneHourAgo);

		const errorSessions = await ctx.db
			.query('streamSessions')
			.withIndex('by_status', (q) => q.eq('status', 'error'))
			.collect();
		const oldErrorSessions = errorSessions.filter(
			(s) => s.completedAt && s.completedAt < oneHourAgo
		);

		const allOldSessions = [...oldStreamingSessions, ...oldDoneSessions, ...oldErrorSessions];

		for (const session of allOldSessions) {
			await ctx.db.delete(session._id);
		}

		return { deleted: allOldSessions.length };
	}
});
