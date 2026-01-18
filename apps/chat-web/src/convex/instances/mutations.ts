import { v } from 'convex/values';

import { mutation } from '../_generated/server';

const instanceStateValidator = v.union(
	v.literal('unprovisioned'),
	v.literal('provisioning'),
	v.literal('stopped'),
	v.literal('starting'),
	v.literal('running'),
	v.literal('stopping'),
	v.literal('updating'),
	v.literal('error')
);

export const create = mutation({
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

export const updateState = mutation({
	args: {
		instanceId: v.id('instances'),
		state: instanceStateValidator
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.instanceId, { state: args.state });
	}
});

export const setProvisioned = mutation({
	args: {
		instanceId: v.id('instances'),
		sandboxId: v.string(),
		btcaVersion: v.optional(v.string()),
		opencodeVersion: v.optional(v.string()),
		storageUsedBytes: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const patch: {
			sandboxId: string;
			state: 'stopped';
			provisionedAt: number;
			btcaVersion?: string;
			opencodeVersion?: string;
			storageUsedBytes?: number;
		} = {
			sandboxId: args.sandboxId,
			state: 'stopped',
			provisionedAt: Date.now()
		};

		if (args.btcaVersion !== undefined) {
			patch.btcaVersion = args.btcaVersion;
		}

		if (args.opencodeVersion !== undefined) {
			patch.opencodeVersion = args.opencodeVersion;
		}

		if (args.storageUsedBytes !== undefined) {
			patch.storageUsedBytes = args.storageUsedBytes;
		}

		await ctx.db.patch(args.instanceId, patch);
	}
});

export const setServerUrl = mutation({
	args: {
		instanceId: v.id('instances'),
		serverUrl: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.instanceId, { serverUrl: args.serverUrl });
	}
});

export const setError = mutation({
	args: {
		instanceId: v.id('instances'),
		errorMessage: v.string()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.instanceId, {
			state: 'error',
			errorMessage: args.errorMessage
		});
	}
});

export const setVersions = mutation({
	args: {
		instanceId: v.id('instances'),
		btcaVersion: v.optional(v.string()),
		opencodeVersion: v.optional(v.string()),
		updateAvailable: v.optional(v.boolean()),
		lastVersionCheck: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const patch: {
			btcaVersion?: string;
			opencodeVersion?: string;
			updateAvailable?: boolean;
			lastVersionCheck: number;
		} = {
			lastVersionCheck: args.lastVersionCheck ?? Date.now()
		};

		if (args.btcaVersion !== undefined) {
			patch.btcaVersion = args.btcaVersion;
		}

		if (args.opencodeVersion !== undefined) {
			patch.opencodeVersion = args.opencodeVersion;
		}

		if (args.updateAvailable !== undefined) {
			patch.updateAvailable = args.updateAvailable;
		}

		await ctx.db.patch(args.instanceId, patch);
	}
});

export const touchActivity = mutation({
	args: { instanceId: v.id('instances') },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.instanceId, { lastActiveAt: Date.now() });
	}
});
