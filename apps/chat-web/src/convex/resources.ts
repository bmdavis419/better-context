import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const listGlobal = query({
	args: {},
	handler: async (ctx) => {
		const resources = await ctx.db.query('globalResources').collect();
		return resources.filter((r) => r.isActive);
	}
});

export const listUserResources = query({
	args: { userId: v.id('instances') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.userId))
			.collect();
	}
});

export const listAvailable = query({
	args: { userId: v.id('instances') },
	handler: async (ctx, args) => {
		const globalResources = await ctx.db.query('globalResources').collect();
		const userResources = await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.userId))
			.collect();

		const global = globalResources
			.filter((r) => r.isActive)
			.map((r) => ({
				name: r.name,
				displayName: r.displayName,
				type: r.type,
				url: r.url,
				branch: r.branch,
				searchPath: r.searchPath,
				specialNotes: r.specialNotes,
				isGlobal: true as const
			}));

		const custom = userResources.map((r) => ({
			name: r.name,
			displayName: r.name,
			type: r.type,
			url: r.url,
			branch: r.branch,
			searchPath: r.searchPath,
			specialNotes: r.specialNotes,
			isGlobal: false as const
		}));

		return { global, custom };
	}
});

export const addCustomResource = mutation({
	args: {
		userId: v.id('instances'),
		name: v.string(),
		url: v.string(),
		branch: v.string(),
		searchPath: v.optional(v.string()),
		specialNotes: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert('userResources', {
			instanceId: args.userId,
			name: args.name,
			type: 'git',
			url: args.url,
			branch: args.branch,
			searchPath: args.searchPath,
			specialNotes: args.specialNotes,
			createdAt: Date.now()
		});
	}
});

export const removeCustomResource = mutation({
	args: { resourceId: v.id('userResources') },
	handler: async (ctx, args) => {
		await ctx.db.delete(args.resourceId);
	}
});
