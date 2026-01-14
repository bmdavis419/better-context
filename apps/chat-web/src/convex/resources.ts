import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/**
 * List all available resources for a user (global + custom)
 */
export const listAvailable = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		// Get active global resources
		const globalResources = await ctx.db
			.query('globalResources')
			.filter((q) => q.eq(q.field('isActive'), true))
			.collect();

		// Get user's custom resources
		const userResources = await ctx.db
			.query('userResources')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.collect();

		return {
			global: globalResources.map((r) => ({
				...r,
				source: 'global' as const
			})),
			custom: userResources.map((r) => ({
				...r,
				source: 'custom' as const
			}))
		};
	}
});

/**
 * Get all global resources (for catalog display)
 */
export const listGlobal = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db
			.query('globalResources')
			.filter((q) => q.eq(q.field('isActive'), true))
			.collect();
	}
});

/**
 * Get user's custom resources
 */
export const listUserResources = query({
	args: { userId: v.id('users') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('userResources')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.collect();
	}
});

/**
 * Add a custom resource for a user
 */
export const addCustomResource = mutation({
	args: {
		userId: v.id('users'),
		name: v.string(),
		url: v.string(),
		branch: v.string(),
		searchPath: v.optional(v.string()),
		specialNotes: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// Check if name is unique for this user
		const existing = await ctx.db
			.query('userResources')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.filter((q) => q.eq(q.field('name'), args.name))
			.first();

		if (existing) {
			throw new Error(`Resource with name "${args.name}" already exists`);
		}

		// Check if name conflicts with global resource
		const globalConflict = await ctx.db
			.query('globalResources')
			.withIndex('by_name', (q) => q.eq('name', args.name))
			.first();

		if (globalConflict) {
			throw new Error(`Resource name "${args.name}" conflicts with a global resource`);
		}

		return await ctx.db.insert('userResources', {
			userId: args.userId,
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

/**
 * Remove a custom resource
 */
export const removeCustomResource = mutation({
	args: {
		userId: v.id('users'),
		resourceId: v.id('userResources')
	},
	handler: async (ctx, args) => {
		const resource = await ctx.db.get(args.resourceId);
		if (!resource) {
			throw new Error('Resource not found');
		}
		if (resource.userId !== args.userId) {
			throw new Error('Not authorized to delete this resource');
		}
		await ctx.db.delete(args.resourceId);
	}
});

/**
 * Get a resource by name (checks both global and user resources)
 */
export const getByName = query({
	args: {
		userId: v.id('users'),
		name: v.string()
	},
	handler: async (ctx, args) => {
		// Check global first
		const global = await ctx.db
			.query('globalResources')
			.withIndex('by_name', (q) => q.eq('name', args.name))
			.first();

		if (global && global.isActive) {
			return { ...global, source: 'global' as const };
		}

		// Check user resources
		const userResource = await ctx.db
			.query('userResources')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.filter((q) => q.eq(q.field('name'), args.name))
			.first();

		if (userResource) {
			return { ...userResource, source: 'custom' as const };
		}

		return null;
	}
});

// Admin functions for managing global resources

/**
 * Add a global resource (admin only - call from dashboard or seed script)
 */
export const addGlobalResource = mutation({
	args: {
		name: v.string(),
		displayName: v.string(),
		url: v.string(),
		branch: v.string(),
		searchPath: v.optional(v.string()),
		specialNotes: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// Check if name already exists
		const existing = await ctx.db
			.query('globalResources')
			.withIndex('by_name', (q) => q.eq('name', args.name))
			.first();

		if (existing) {
			throw new Error(`Global resource with name "${args.name}" already exists`);
		}

		return await ctx.db.insert('globalResources', {
			name: args.name,
			displayName: args.displayName,
			type: 'git',
			url: args.url,
			branch: args.branch,
			searchPath: args.searchPath,
			specialNotes: args.specialNotes,
			isActive: true
		});
	}
});

/**
 * Toggle global resource active status
 */
export const toggleGlobalResource = mutation({
	args: { resourceId: v.id('globalResources') },
	handler: async (ctx, args) => {
		const resource = await ctx.db.get(args.resourceId);
		if (!resource) {
			throw new Error('Resource not found');
		}
		await ctx.db.patch(args.resourceId, { isActive: !resource.isActive });
	}
});
