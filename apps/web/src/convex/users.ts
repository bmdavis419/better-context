import { v } from 'convex/values';

import { mutation } from './_generated/server';
import { create as createInstance } from './instances/mutations';
import { getByClerkId as getInstance } from './instances/queries';
import { getAuthenticatedInstanceResult, unwrapAuthResult } from './authHelpers';

export const get = getInstance;

export const getOrCreate = createInstance;

/**
 * Update sandbox activity for the authenticated user's instance
 */
export const updateSandboxActivity = mutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));

		await ctx.db.patch(instance._id, {
			lastActiveAt: Date.now()
		});
		return null;
	}
});

/**
 * Touch MCP usage for the authenticated user's instance
 */
export const touchMcpUsage = mutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));

		await ctx.db.patch(instance._id, {
			lastActiveAt: Date.now()
		});
		return null;
	}
});

/**
 * Set MCP sandbox ID for the authenticated user's instance
 */
export const setMcpSandboxId = mutation({
	args: {},
	returns: v.null(),
	handler: async (ctx) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));

		await ctx.db.patch(instance._id, {
			lastActiveAt: Date.now()
		});
		return null;
	}
});
