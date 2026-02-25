import { v } from 'convex/values';
import { Result } from 'better-result';

import { internalQuery, query } from '../_generated/server';
import { requireInstanceOwnershipResult, unwrapAuthResult } from '../authHelpers';
import { WebAuthError } from '../../lib/result/errors';

// Instance validator
const instanceValidator = v.object({
	_id: v.id('instances'),
	_creationTime: v.number(),
	clerkId: v.string(),
	sandboxId: v.optional(v.string()),
	state: v.union(
		v.literal('unprovisioned'),
		v.literal('provisioning'),
		v.literal('stopped'),
		v.literal('starting'),
		v.literal('running'),
		v.literal('stopping'),
		v.literal('updating'),
		v.literal('error')
	),
	serverUrl: v.optional(v.string()),
	errorMessage: v.optional(v.string()),
	btcaVersion: v.optional(v.string()),
	opencodeVersion: v.optional(v.string()),
	latestBtcaVersion: v.optional(v.string()),
	latestOpencodeVersion: v.optional(v.string()),
	lastVersionCheck: v.optional(v.number()),
	subscriptionPlan: v.optional(v.union(v.literal('pro'), v.literal('free'), v.literal('none'))),
	subscriptionStatus: v.optional(
		v.union(v.literal('active'), v.literal('trialing'), v.literal('canceled'), v.literal('none'))
	),
	subscriptionProductId: v.optional(v.string()),
	subscriptionCurrentPeriodEnd: v.optional(v.number()),
	subscriptionCanceledAt: v.optional(v.number()),
	subscriptionUpdatedAt: v.optional(v.number()),
	storageUsedBytes: v.optional(v.number()),
	lastActiveAt: v.optional(v.number()),
	provisionedAt: v.optional(v.number()),
	createdAt: v.number()
});

const cachedResourceValidator = v.object({
	_id: v.id('cachedResources'),
	_creationTime: v.number(),
	instanceId: v.id('instances'),
	projectId: v.optional(v.id('projects')),
	name: v.string(),
	type: v.optional(v.union(v.literal('git'), v.literal('npm'))),
	url: v.optional(v.string()),
	branch: v.optional(v.string()),
	package: v.optional(v.string()),
	version: v.optional(v.string()),
	sizeBytes: v.optional(v.number()),
	cachedAt: v.number(),
	lastUsedAt: v.number()
});

/**
 * Internal query to get instance by ID (for use by other internal functions)
 * This should only be called from trusted server-side code
 */
export const getInternal = internalQuery({
	args: { id: v.id('instances') },
	returns: v.union(v.null(), instanceValidator),
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
	returns: v.union(v.null(), instanceValidator),
	handler: async (ctx, args) => {
		const instanceResult = await requireInstanceOwnershipResult(ctx, args.id);
		if (Result.isError(instanceResult) && WebAuthError.is(instanceResult.error)) {
			if (instanceResult.error.code === 'NOT_FOUND') {
				return null;
			}
		}
		if (Result.isError(instanceResult)) {
			return null;
		}
		const instance = await unwrapAuthResult(instanceResult);
		return instance;
	}
});

export const getBySandboxId = internalQuery({
	args: { sandboxId: v.string() },
	returns: v.union(v.null(), instanceValidator),
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
	returns: v.union(v.null(), instanceValidator),
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
	returns: v.union(v.null(), instanceValidator),
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
	returns: v.union(
		v.null(),
		v.object({
			instance: instanceValidator,
			cachedResources: v.array(cachedResourceValidator)
		})
	),
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
