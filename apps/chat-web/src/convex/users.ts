import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

/**
 * Get or create a user from Clerk authentication
 */
export const getOrCreate = mutation({
	args: {
		clerkId: v.string(),
		email: v.string(),
		name: v.optional(v.string()),
		imageUrl: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		// Check if user already exists
		const existing = await ctx.db
			.query('users')
			.withIndex('by_clerk_id', (q) => q.eq('clerkId', args.clerkId))
			.first();

		if (existing) {
			// Update user info if changed
			if (
				existing.email !== args.email ||
				existing.name !== args.name ||
				existing.imageUrl !== args.imageUrl
			) {
				await ctx.db.patch(existing._id, {
					email: args.email,
					name: args.name,
					imageUrl: args.imageUrl
				});
			}
			return existing._id;
		}

		// Create new user
		return await ctx.db.insert('users', {
			clerkId: args.clerkId,
			email: args.email,
			name: args.name,
			imageUrl: args.imageUrl,
			createdAt: Date.now()
		});
	}
});

/**
 * Get current user by Clerk ID
 */
export const getByClerkId = query({
	args: { clerkId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('users')
			.withIndex('by_clerk_id', (q) => q.eq('clerkId', args.clerkId))
			.first();
	}
});

/**
 * Get user by internal ID
 */
export const get = query({
	args: { id: v.id('users') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.id);
	}
});

/**
 * Update sandbox activity timestamp for usage tracking
 */
export const updateSandboxActivity = mutation({
	args: {
		userId: v.id('users'),
		timestamp: v.number()
	},
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) throw new Error('User not found');
		await ctx.db.patch(args.userId, { sandboxLastActiveAt: args.timestamp });
	}
});

/**
 * Store MCP sandbox id for a user
 */
export const setMcpSandboxId = mutation({
	args: {
		userId: v.id('users'),
		sandboxId: v.string()
	},
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) throw new Error('User not found');
		await ctx.db.patch(args.userId, { mcpSandboxId: args.sandboxId });
	}
});

/**
 * Touch MCP usage timestamp
 */
export const touchMcpUsage = mutation({
	args: {
		userId: v.id('users'),
		timestamp: v.number()
	},
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) throw new Error('User not found');
		await ctx.db.patch(args.userId, { mcpLastUsedAt: args.timestamp });
	}
});
