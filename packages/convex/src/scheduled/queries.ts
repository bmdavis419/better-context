import { v } from 'convex/values';

import { internalQuery } from '../_generated/server.js';

export const listActiveInstances = internalQuery({
	args: { cutoff: v.number() },
	handler: async (ctx, args) => {
		const instances = await ctx.db.query('instances').collect();
		return instances.filter((instance) => (instance.lastActiveAt ?? 0) >= args.cutoff);
	}
});

export const listInstances = internalQuery({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query('instances').collect();
	}
});
