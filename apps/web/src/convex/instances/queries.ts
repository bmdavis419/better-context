import { v } from 'convex/values';

import { internalQuery, query } from '../_generated/server';

/**
 * Internal query to get instance by ID (for use by other internal functions)
 * This should only be called from trusted server-side code
 */
export const getInternal = internalQuery({
	args: { id: v.id('instances') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	}
});

/**
 * Get instance by ID (requires ownership verification)
 * Public queries should use getByClerkId instead to get the authenticated user's instance
 */
export const get = query({
	args: { id: v.id('instances') },
	handler: async (ctx, args) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new Error('Unauthorized: Authentication required');
		}

		const instance = await ctx.db.get(args.id);
		if (!instance) {
			return null;
		}

		// Verify the caller owns this instance
		if (instance.clerkId !== identity.subject) {
			throw new Error('Unauthorized: Access denied');
		}

		return instance;
	}
});

export const getBySandboxId = internalQuery({
	args: { sandboxId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('instances')
			.withIndex('by_sandbox_id', (q) => q.eq('sandboxId', args.sandboxId))
			.first();
	}
});

/**
 * Get the authenticated user's instance by their Clerk ID
 */
export const getByClerkId = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return null;
		}

		return await ctx.db
			.query('instances')
			.withIndex('by_clerk_id', (q) => q.eq('clerkId', identity.subject))
			.first();
	}
});

/**
 * Internal query to get instance by Clerk ID
 * Used by API key validation when we have the Clerk user ID but no auth context
 */
export const getByClerkIdInternal = internalQuery({
	args: { clerkId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('instances')
			.withIndex('by_clerk_id', (q) => q.eq('clerkId', args.clerkId))
			.first();
	}
});

/**
 * Get instance status for the authenticated user
 */
export const getStatus = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return null;
		}

		const instance = await ctx.db
			.query('instances')
			.withIndex('by_clerk_id', (q) => q.eq('clerkId', identity.subject))
			.first();

		if (!instance) {
			return null;
		}

		const cachedResources = await ctx.db
			.query('cachedResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', instance._id))
			.collect();

		cachedResources.sort((a, b) => b.lastUsedAt - a.lastUsedAt);

		return {
			instance,
			cachedResources
		};
	}
});
