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
