import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { AnalyticsEvents } from '../analyticsEvents';
import { instances } from '../apiHelpers';

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

		const instanceId = await ctx.db.insert('instances', {
			clerkId: args.clerkId,
			state: 'unprovisioned',
			createdAt: Date.now()
		});

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: args.clerkId,
			event: AnalyticsEvents.INSTANCE_CREATED,
			properties: { instanceId }
		});

		return instanceId;
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
		const instance = await ctx.db.get(args.instanceId);
		const previousState = instance?.state;

		await ctx.db.patch(args.instanceId, {
			state: 'error',
			errorMessage: args.errorMessage
		});

		if (instance) {
			await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
				distinctId: instance.clerkId,
				event: AnalyticsEvents.INSTANCE_ERROR,
				properties: {
					instanceId: args.instanceId,
					errorMessage: args.errorMessage,
					previousState
				}
			});
		}
	}
});

export const clearError = mutation({
	args: { instanceId: v.id('instances') },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.instanceId, { errorMessage: undefined });
	}
});

export const setVersions = mutation({
	args: {
		instanceId: v.id('instances'),
		btcaVersion: v.optional(v.string()),
		opencodeVersion: v.optional(v.string()),
		latestBtcaVersion: v.optional(v.string()),
		latestOpencodeVersion: v.optional(v.string()),
		lastVersionCheck: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const patch: {
			btcaVersion?: string;
			opencodeVersion?: string;
			latestBtcaVersion?: string;
			latestOpencodeVersion?: string;
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

		if (args.latestBtcaVersion !== undefined) {
			patch.latestBtcaVersion = args.latestBtcaVersion;
		}

		if (args.latestOpencodeVersion !== undefined) {
			patch.latestOpencodeVersion = args.latestOpencodeVersion;
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

export const updateStorageUsed = mutation({
	args: {
		instanceId: v.id('instances'),
		storageUsedBytes: v.number()
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.instanceId, { storageUsedBytes: args.storageUsedBytes });
	}
});

export const setSubscriptionState = mutation({
	args: {
		instanceId: v.id('instances'),
		plan: v.union(v.literal('pro'), v.literal('free'), v.literal('none')),
		status: v.union(
			v.literal('active'),
			v.literal('trialing'),
			v.literal('canceled'),
			v.literal('none')
		),
		productId: v.optional(v.string()),
		currentPeriodEnd: v.optional(v.number()),
		canceledAt: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.instanceId, {
			subscriptionPlan: args.plan,
			subscriptionStatus: args.status,
			subscriptionProductId: args.productId,
			subscriptionCurrentPeriodEnd: args.currentPeriodEnd,
			subscriptionCanceledAt: args.canceledAt,
			subscriptionUpdatedAt: Date.now()
		});
	}
});

export const upsertCachedResources = mutation({
	args: {
		instanceId: v.id('instances'),
		resources: v.array(
			v.object({
				name: v.string(),
				url: v.string(),
				branch: v.string(),
				sizeBytes: v.optional(v.number())
			})
		)
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('cachedResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();

		const existingByName = new Map(existing.map((r) => [r.name, r]));
		const now = Date.now();

		for (const resource of args.resources) {
			const existingResource = existingByName.get(resource.name);
			if (existingResource) {
				await ctx.db.patch(existingResource._id, {
					url: resource.url,
					branch: resource.branch,
					sizeBytes: resource.sizeBytes,
					lastUsedAt: now
				});
			} else {
				await ctx.db.insert('cachedResources', {
					instanceId: args.instanceId,
					name: resource.name,
					url: resource.url,
					branch: resource.branch,
					sizeBytes: resource.sizeBytes,
					cachedAt: now,
					lastUsedAt: now
				});
			}
		}
	}
});

export const scheduleSyncSandboxStatus = mutation({
	args: { instanceId: v.id('instances') },
	handler: async (ctx, args) => {
		await ctx.scheduler.runAfter(0, instances.internalActions.syncSandboxStatus, {
			instanceId: args.instanceId
		});
	}
});

export const handleSandboxStopped = mutation({
	args: { sandboxId: v.string() },
	handler: async (ctx, args) => {
		const instance = await ctx.db
			.query('instances')
			.withIndex('by_sandbox_id', (q) => q.eq('sandboxId', args.sandboxId))
			.first();

		if (!instance) {
			return { updated: false, reason: 'instance_not_found' };
		}

		if (instance.state === 'stopped') {
			return { updated: false, reason: 'already_stopped' };
		}

		const wasAutoStopped = instance.state === 'running';

		await ctx.db.patch(instance._id, {
			state: 'stopped',
			serverUrl: ''
		});

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.SANDBOX_STOPPED,
			properties: {
				instanceId: instance._id,
				sandboxId: args.sandboxId,
				wasAutoStopped
			}
		});

		return { updated: true, instanceId: instance._id };
	}
});

export const handleSandboxStarted = mutation({
	args: { sandboxId: v.string() },
	handler: async (ctx, args) => {
		const instance = await ctx.db
			.query('instances')
			.withIndex('by_sandbox_id', (q) => q.eq('sandboxId', args.sandboxId))
			.first();

		if (!instance) {
			return { updated: false, reason: 'instance_not_found' };
		}

		if (instance.state === 'running' || instance.state === 'starting') {
			return { updated: false, reason: 'already_running_or_starting' };
		}

		await ctx.db.patch(instance._id, {
			state: 'starting'
		});

		return { updated: true, instanceId: instance._id };
	}
});
