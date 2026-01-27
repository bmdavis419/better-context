import { v } from 'convex/values';

import { internalMutation, internalQuery, query } from './_generated/server';

// ─────────────────────────────────────────────────────────────────────────────
// Internal Mutations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update usage tracking for an API key.
 * Creates a new record if this is the first use.
 */
export const touchUsage = internalMutation({
	args: {
		clerkApiKeyId: v.string(),
		clerkUserId: v.string(),
		instanceId: v.id('instances'),
		name: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const { clerkApiKeyId, clerkUserId, instanceId, name } = args;

		const existing = await ctx.db
			.query('apiKeyUsage')
			.withIndex('by_clerk_api_key_id', (q) => q.eq('clerkApiKeyId', clerkApiKeyId))
			.first();

		if (existing) {
			await ctx.db.patch(existing._id, {
				lastUsedAt: Date.now(),
				usageCount: existing.usageCount + 1,
				...(name && { name })
			});
		} else {
			await ctx.db.insert('apiKeyUsage', {
				clerkApiKeyId,
				clerkUserId,
				instanceId,
				name,
				lastUsedAt: Date.now(),
				usageCount: 1,
				createdAt: Date.now()
			});
		}
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List usage stats for an instance's API keys.
 * Used by the UI to show usage information alongside Clerk's key list.
 */
export const listUsageByInstance = internalQuery({
	args: { instanceId: v.id('instances') },
	handler: async (ctx, args) => {
		return await ctx.db
			.query('apiKeyUsage')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// Public Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List usage stats for the authenticated user's API keys.
 * Public query - requires auth.
 */
export const listUsageForUser = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return [];

		const instance = await ctx.db
			.query('instances')
			.withIndex('by_clerk_id', (q) => q.eq('clerkId', identity.subject))
			.first();

		if (!instance) return [];

		return await ctx.db
			.query('apiKeyUsage')
			.withIndex('by_instance', (q) => q.eq('instanceId', instance._id))
			.collect();
	}
});
