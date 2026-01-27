import { GLOBAL_RESOURCES } from '@btca/shared';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

import { internal } from './_generated/api';
import { AnalyticsEvents } from './analyticsEvents';
import { instances } from './apiHelpers';
import { getAuthenticatedInstance, requireUserResourceOwnership } from './authHelpers';

/**
 * List global resources (public, no auth required)
 */
export const listGlobal = query({
	args: {},
	handler: async (ctx) => {
		void ctx;
		return GLOBAL_RESOURCES;
	}
});

/**
 * List user resources for the authenticated user's instance, optionally filtered by project
 */
export const listUserResources = query({
	args: {
		projectId: v.optional(v.id('projects'))
	},
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);

		if (args.projectId) {
			const resources = await ctx.db
				.query('userResources')
				.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
				.collect();
			return resources.filter((r) => r.instanceId === instance._id);
		}

		const allResources = await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', instance._id))
			.collect();

		const seen = new Set<string>();
		return allResources.filter((r) => {
			if (seen.has(r.name)) return false;
			seen.add(r.name);
			return true;
		});
	}
});

/**
 * List all available resources (global + custom) for the authenticated user's instance
 */
export const listAvailable = query({
	args: {},
	handler: async (ctx) => {
		const instance = await getAuthenticatedInstance(ctx);

		const userResources = await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', instance._id))
			.collect();

		const global = GLOBAL_RESOURCES.map((resource) => ({
			name: resource.name,
			displayName: resource.displayName,
			type: resource.type,
			url: resource.url,
			branch: resource.branch,
			searchPath: resource.searchPath ?? resource.searchPaths?.[0],
			specialNotes: resource.specialNotes,
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

/**
 * Internal version that accepts instanceId (for use by internal actions only)
 * This is needed for server-side operations that run without user auth context
 */
export const listAvailableInternal = query({
	args: { instanceId: v.id('instances') },
	handler: async (ctx, args) => {
		const userResources = await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();

		const global = GLOBAL_RESOURCES.map((resource) => ({
			name: resource.name,
			displayName: resource.displayName,
			type: resource.type,
			url: resource.url,
			branch: resource.branch,
			searchPath: resource.searchPath ?? resource.searchPaths?.[0],
			specialNotes: resource.specialNotes,
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

/**
 * Add a custom resource to the authenticated user's instance
 */
export const addCustomResource = mutation({
	args: {
		name: v.string(),
		url: v.string(),
		branch: v.string(),
		searchPath: v.optional(v.string()),
		specialNotes: v.optional(v.string()),
		projectId: v.optional(v.id('projects'))
	},
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);

		const resourceId = await ctx.db.insert('userResources', {
			instanceId: instance._id,
			projectId: args.projectId,
			name: args.name,
			type: 'git',
			url: args.url,
			branch: args.branch,
			searchPath: args.searchPath,
			specialNotes: args.specialNotes,
			createdAt: Date.now()
		});

		await ctx.scheduler.runAfter(0, instances.internalActions.syncResources, {
			instanceId: instance._id
		});

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.RESOURCE_ADDED,
			properties: {
				instanceId: instance._id,
				resourceId,
				resourceName: args.name,
				resourceUrl: args.url,
				hasBranch: args.branch !== 'main',
				hasSearchPath: !!args.searchPath,
				hasNotes: !!args.specialNotes
			}
		});

		return resourceId;
	}
});

/**
 * Remove a custom resource (requires ownership)
 */
export const removeCustomResource = mutation({
	args: { resourceId: v.id('userResources') },
	handler: async (ctx, args) => {
		const { resource, instance } = await requireUserResourceOwnership(ctx, args.resourceId);

		await ctx.db.delete(args.resourceId);

		await ctx.scheduler.runAfter(0, instances.internalActions.syncResources, {
			instanceId: resource.instanceId
		});

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.RESOURCE_REMOVED,
			properties: {
				instanceId: resource.instanceId,
				resourceId: args.resourceId,
				resourceName: resource.name
			}
		});
	}
});
