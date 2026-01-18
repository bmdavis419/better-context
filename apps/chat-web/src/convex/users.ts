import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const get = query({
	args: { id: v.id('instances') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	}
});

export const getOrCreate = mutation({
	args: { clerkId: v.string() },
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('instances')
			.withIndex('by_clerk_id', (q) => q.eq('clerkId', args.clerkId))
			.first();

		if (existing) {
			return existing._id;
		}

		return await ctx.db.insert('instances', {
			clerkId: args.clerkId,
			state: 'unprovisioned',
			createdAt: Date.now()
		});
	}
});

export const updateSandboxActivity = mutation({
	args: {
		userId: v.id('instances'),
		sandboxId: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.userId, {
			sandboxId: args.sandboxId,
			lastActiveAt: Date.now()
		});
	}
});

export const touchMcpUsage = mutation({
	args: { userId: v.id('instances') },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.userId, {
			lastActiveAt: Date.now()
		});
	}
});

export const setMcpSandboxId = mutation({
	args: {
		userId: v.id('instances'),
		sandboxId: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.userId, {
			sandboxId: args.sandboxId,
			lastActiveAt: Date.now()
		});
	}
});
