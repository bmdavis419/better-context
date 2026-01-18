import { v } from 'convex/values';

import { query } from '../_generated/server';

export const get = query({
	args: { id: v.id('instances') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	}
});

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
