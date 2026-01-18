import { v } from 'convex/values';

import { mutation } from './_generated/server';
import { create as createInstance } from './instances/mutations';
import { get as getInstance } from './instances/queries';

export const get = getInstance;

export const getOrCreate = createInstance;

export const updateSandboxActivity = mutation({
	args: {
		userId: v.id('instances'),
		sandboxId: v.string()
	},
	handler: async (ctx, args) => {
		void args.sandboxId;
		await ctx.db.patch(args.userId, {
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
