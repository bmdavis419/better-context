import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { AnalyticsEvents } from '../analyticsEvents';
import { instances } from '../apiHelpers';
import { privateMutation } from '../privateWrappers';

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

export const create = privateMutation({
	args: { clerkId: v.string() },
	returns: v.id('instances'),
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

export const updateState = privateMutation({
	args: {
		instanceId: v.id('instances'),
		state: instanceStateValidator
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.instanceId, { state: args.state });
		return null;
	}
});

export const setProvisioned = privateMutation({
	args: {
		instanceId: v.id('instances'),
		sandboxId: v.string(),
		snapshotName: v.string(),
		btcaVersion: v.optional(v.string()),
		storageUsedBytes: v.optional(v.number())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const patch: {
			sandboxId: string;
			snapshotName: string;
			state: 'stopped';
			provisionedAt: number;
			serverUrl: string;
			errorKind: undefined;
			errorMessage: undefined;
			storageUsedBytes: number;
			btcaVersion?: string;
		} = {
			sandboxId: args.sandboxId,
			snapshotName: args.snapshotName,
			state: 'stopped',
			provisionedAt: Date.now(),
			serverUrl: '',
			errorKind: undefined,
			errorMessage: undefined,
			storageUsedBytes: args.storageUsedBytes ?? 0
		};

		if (args.btcaVersion !== undefined) {
			patch.btcaVersion = args.btcaVersion;
		}

		const cachedResources = await ctx.db
			.query('cachedResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();

		for (const resource of cachedResources) {
			await ctx.db.delete(resource._id);
		}

		await ctx.db.patch(args.instanceId, patch);
		return null;
	}
});

export const setServerUrl = privateMutation({
	args: {
		instanceId: v.id('instances'),
		serverUrl: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.instanceId, { serverUrl: args.serverUrl });
		return null;
	}
});

export const setError = privateMutation({
	args: {
		instanceId: v.id('instances'),
		errorKind: v.optional(v.union(v.literal('disk_full'), v.literal('generic'))),
		errorMessage: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const instance = await ctx.db.get(args.instanceId);
		const previousState = instance?.state;

		await ctx.db.patch(args.instanceId, {
			state: 'error',
			errorKind: args.errorKind ?? 'generic',
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
		return null;
	}
});

export const clearError = privateMutation({
	args: { instanceId: v.id('instances') },
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.instanceId, {
			errorKind: undefined,
			errorMessage: undefined
		});
		return null;
	}
});

export const setVersions = privateMutation({
	args: {
		instanceId: v.id('instances'),
		btcaVersion: v.optional(v.string()),
		latestBtcaVersion: v.optional(v.string()),
		lastVersionCheck: v.optional(v.number())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const patch: {
			btcaVersion?: string;
			latestBtcaVersion?: string;
			lastVersionCheck: number;
		} = {
			lastVersionCheck: args.lastVersionCheck ?? Date.now()
		};

		if (args.btcaVersion !== undefined) {
			patch.btcaVersion = args.btcaVersion;
		}

		if (args.latestBtcaVersion !== undefined) {
			patch.latestBtcaVersion = args.latestBtcaVersion;
		}

		await ctx.db.patch(args.instanceId, patch);
		return null;
	}
});

export const touchActivity = privateMutation({
	args: { instanceId: v.id('instances') },
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.instanceId, { lastActiveAt: Date.now() });
		return null;
	}
});

export const updateStorageUsed = privateMutation({
	args: {
		instanceId: v.id('instances'),
		storageUsedBytes: v.number()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.instanceId, { storageUsedBytes: args.storageUsedBytes });
		return null;
	}
});

export const setSubscriptionState = privateMutation({
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
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.db.patch(args.instanceId, {
			subscriptionPlan: args.plan,
			subscriptionStatus: args.status,
			subscriptionProductId: args.productId,
			subscriptionCurrentPeriodEnd: args.currentPeriodEnd,
			subscriptionCanceledAt: args.canceledAt,
			subscriptionUpdatedAt: Date.now()
		});
		return null;
	}
});

export const upsertCachedResources = privateMutation({
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
	returns: v.null(),
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
		return null;
	}
});

export const scheduleSyncSandboxStatus = privateMutation({
	args: { instanceId: v.id('instances') },
	returns: v.null(),
	handler: async (ctx, args) => {
		await ctx.scheduler.runAfter(0, instances.internalActions.syncSandboxStatus, {
			instanceId: args.instanceId
		});
		return null;
	}
});

export const handleSandboxStopped = privateMutation({
	args: { sandboxId: v.string() },
	returns: v.union(
		v.object({ updated: v.literal(false), reason: v.string() }),
		v.object({ updated: v.literal(true), instanceId: v.id('instances') })
	),
	handler: async (ctx, args) => {
		const instance = await ctx.db
			.query('instances')
			.withIndex('by_sandbox_id', (q) => q.eq('sandboxId', args.sandboxId))
			.first();

		if (!instance) {
			return { updated: false as const, reason: 'instance_not_found' };
		}

		if (instance.state === 'stopped') {
			return { updated: false as const, reason: 'already_stopped' };
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

		return { updated: true as const, instanceId: instance._id };
	}
});

export const handleSandboxStarted = privateMutation({
	args: { sandboxId: v.string() },
	returns: v.union(
		v.object({ updated: v.literal(false), reason: v.string() }),
		v.object({ updated: v.literal(true), instanceId: v.id('instances') })
	),
	handler: async (ctx, args) => {
		const instance = await ctx.db
			.query('instances')
			.withIndex('by_sandbox_id', (q) => q.eq('sandboxId', args.sandboxId))
			.first();

		if (!instance) {
			return { updated: false as const, reason: 'instance_not_found' };
		}

		if (instance.state === 'running' || instance.state === 'starting') {
			return { updated: false as const, reason: 'already_running_or_starting' };
		}

		await ctx.db.patch(instance._id, {
			state: 'starting'
		});

		return { updated: true as const, instanceId: instance._id };
	}
});
