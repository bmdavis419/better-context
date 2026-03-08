import { GLOBAL_RESOURCES, getResourceNameError } from '@btca/shared';
import { v } from 'convex/values';
import { Result } from 'better-result';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';

import { internal } from './_generated/api';
import { AnalyticsEvents } from './analyticsEvents';
import { instances } from './apiHelpers';
import {
	getAuthenticatedInstanceResult,
	requireUserResourceOwnershipResult,
	unwrapAuthResult
} from './authHelpers';
import { WebValidationError } from './lib/result/errors';
import type { WebError } from './lib/result/errors';

type ResourceNameResult = Result<string, WebValidationError>;

const validateResourceNameResult = (name: string): ResourceNameResult => {
	const nameError = getResourceNameError(name);
	if (nameError) {
		return Result.err(new WebValidationError({ message: nameError, field: 'name' }));
	}
	return Result.ok(name);
};

const throwResourceError = (error: WebError): never => {
	throw error;
};

const getGitProvider = (url?: string): 'github' | 'generic' => {
	if (!url) return 'generic';
	try {
		return new URL(url).hostname.toLowerCase() === 'github.com' ? 'github' : 'generic';
	} catch {
		return 'generic';
	}
};

const shouldIncludeResource = (
	resource: {
		visibility?: 'public' | 'private';
		authSource?: 'clerk_github_oauth' | 'github_app';
	},
	includePrivate: boolean
) => includePrivate || resource.visibility !== 'private';

const getStoredResourceType = (resource: { type?: 'git' | 'npm'; package?: string }) =>
	resource.type === 'npm' || resource.package ? 'npm' : 'git';

const normalizeUserResource = <
	T extends {
		_id: unknown;
		_creationTime: number;
		instanceId: unknown;
		projectId?: unknown;
		name: string;
		type?: 'git' | 'npm';
		url?: string;
		branch?: string;
		package?: string;
		version?: string;
		searchPath?: string;
		specialNotes?: string;
		gitProvider?: 'github' | 'generic';
		visibility?: 'public' | 'private';
		authSource?: 'clerk_github_oauth' | 'github_app';
		createdAt: number;
	}
>(
	resource: T
) => {
	const type = getStoredResourceType(resource);
	return {
		...resource,
		type,
		...(type === 'git'
			? {
					gitProvider: resource.gitProvider ?? getGitProvider(resource.url),
					visibility: resource.visibility ?? 'public',
					authSource: resource.authSource
				}
			: {}),
		...(type === 'git' ? { branch: resource.branch ?? 'main' } : {})
	};
};

const toCustomResource = (resource: {
	name: string;
	type?: 'git' | 'npm';
	url?: string;
	branch?: string;
	package?: string;
	version?: string;
	searchPath?: string;
	specialNotes?: string;
	gitProvider?: 'github' | 'generic';
	visibility?: 'public' | 'private';
	authSource?: 'clerk_github_oauth' | 'github_app';
}): {
	name: string;
	displayName: string;
	type: 'git' | 'npm';
	url?: string;
	branch?: string;
	package?: string;
	version?: string;
	searchPath?: string;
	specialNotes?: string;
	gitProvider?: 'github' | 'generic';
	visibility?: 'public' | 'private';
	authSource?: 'clerk_github_oauth' | 'github_app';
	isGlobal: false;
} => {
	const type = getStoredResourceType(resource);
	return {
		name: resource.name,
		displayName: resource.name,
		type,
		...(resource.url ? { url: resource.url } : {}),
		...(type === 'git' ? { branch: resource.branch ?? 'main' } : {}),
		...(resource.package ? { package: resource.package } : {}),
		...(resource.version ? { version: resource.version } : {}),
		...(resource.searchPath ? { searchPath: resource.searchPath } : {}),
		...(resource.specialNotes ? { specialNotes: resource.specialNotes } : {}),
		...(type === 'git'
			? {
					gitProvider: resource.gitProvider ?? getGitProvider(resource.url),
					visibility: resource.visibility ?? 'public',
					authSource: resource.authSource
				}
			: {}),
		isGlobal: false as const
	};
};

// Resource validators
const globalResourceValidator = v.object({
	name: v.string(),
	displayName: v.string(),
	type: v.string(),
	url: v.string(),
	branch: v.string(),
	searchPath: v.optional(v.string()),
	specialNotes: v.optional(v.string()),
	isGlobal: v.literal(true)
});

const customResourceValidator = v.object({
	name: v.string(),
	displayName: v.string(),
	type: v.union(v.literal('git'), v.literal('npm')),
	url: v.optional(v.string()),
	branch: v.optional(v.string()),
	package: v.optional(v.string()),
	version: v.optional(v.string()),
	searchPath: v.optional(v.string()),
	specialNotes: v.optional(v.string()),
	gitProvider: v.optional(v.union(v.literal('github'), v.literal('generic'))),
	visibility: v.optional(v.union(v.literal('public'), v.literal('private'))),
	authSource: v.optional(v.union(v.literal('clerk_github_oauth'), v.literal('github_app'))),
	isGlobal: v.literal(false)
});

const userResourceValidator = v.object({
	_id: v.id('userResources'),
	_creationTime: v.number(),
	instanceId: v.id('instances'),
	projectId: v.optional(v.id('projects')),
	name: v.string(),
	type: v.union(v.literal('git'), v.literal('npm')),
	url: v.optional(v.string()),
	branch: v.optional(v.string()),
	package: v.optional(v.string()),
	version: v.optional(v.string()),
	searchPath: v.optional(v.string()),
	specialNotes: v.optional(v.string()),
	gitProvider: v.optional(v.union(v.literal('github'), v.literal('generic'))),
	visibility: v.optional(v.union(v.literal('public'), v.literal('private'))),
	authSource: v.optional(v.union(v.literal('clerk_github_oauth'), v.literal('github_app'))),
	createdAt: v.number()
});

/**
 * List global resources (public, no auth required)
 */
export const listGlobal = query({
	args: {},
	returns: v.array(
		v.object({
			name: v.string(),
			displayName: v.string(),
			type: v.string(),
			url: v.string(),
			branch: v.string(),
			searchPath: v.optional(v.string()),
			searchPaths: v.optional(v.array(v.string())),
			specialNotes: v.optional(v.string())
		})
	),
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
	returns: v.array(userResourceValidator),
	handler: async (ctx, args) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));

		if (args.projectId) {
			const resources = await ctx.db
				.query('userResources')
				.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
				.collect();
			return resources
				.filter((r) => r.instanceId === instance._id)
				.map((resource) => normalizeUserResource(resource));
		}

		const allResources = await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', instance._id))
			.collect();

		const seen = new Set<string>();
		return allResources
			.filter((r) => {
				if (seen.has(r.name)) return false;
				seen.add(r.name);
				return true;
			})
			.map((resource) => normalizeUserResource(resource));
	}
});

/**
 * List all available resources (global + custom) for the authenticated user's instance
 */
export const listAvailable = query({
	args: {},
	returns: v.object({
		global: v.array(globalResourceValidator),
		custom: v.array(customResourceValidator)
	}),
	handler: async (ctx) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));

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

		const custom = userResources.map((r) => toCustomResource(r));

		return { global, custom };
	}
});

/**
 * Check if a resource name already exists anywhere on the instance (case-insensitive).
 *
 * Resource cache directories are keyed by resource name inside btca, so allowing the same name
 * across projects can cause one project's repo checkout to be reused for another project.
 */
export const resourceExistsInProject = internalQuery({
	args: {
		projectId: v.id('projects'),
		name: v.string()
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const project = await ctx.db.get(args.projectId);
		if (!project) {
			return false;
		}

		const instanceResources = await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', project.instanceId))
			.collect();

		return instanceResources.some(
			(resource) => resource.name.toLowerCase() === args.name.toLowerCase()
		);
	}
});

/**
 * List resources for a specific project (internal)
 */
export const listByProject = internalQuery({
	args: {
		projectId: v.id('projects')
	},
	returns: v.array(userResourceValidator),
	handler: async (ctx, args) => {
		const resources = await ctx.db
			.query('userResources')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();
		return resources.map((resource) => normalizeUserResource(resource));
	}
});

/**
 * Internal version that accepts instanceId (for use by internal actions only)
 * This is needed for server-side operations that run without user auth context
 */
export const listAvailableInternal = internalQuery({
	args: {
		instanceId: v.id('instances'),
		includePrivate: v.optional(v.boolean())
	},
	returns: v.object({
		global: v.array(globalResourceValidator),
		custom: v.array(customResourceValidator)
	}),
	handler: async (ctx, args) => {
		const userResources = await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();
		const includePrivate = args.includePrivate ?? false;

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

		const custom = userResources
			.filter((resource) => shouldIncludeResource(resource, includePrivate))
			.map((r) => toCustomResource(r));

		return { global, custom };
	}
});

/**
 * Internal version that filters by project (for use by internal actions only)
 * Returns global resources plus custom resources for the specific project
 */
export const listAvailableForProject = internalQuery({
	args: {
		projectId: v.id('projects'),
		includePrivate: v.optional(v.boolean())
	},
	returns: v.object({
		global: v.array(globalResourceValidator),
		custom: v.array(customResourceValidator)
	}),
	handler: async (ctx, args) => {
		const userResources = await ctx.db
			.query('userResources')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();
		const includePrivate = args.includePrivate ?? false;

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

		const custom = userResources
			.filter((resource) => shouldIncludeResource(resource, includePrivate))
			.map((r) => toCustomResource(r));

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
	returns: v.id('userResources'),
	handler: async (ctx, args) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));
		const nameResult = validateResourceNameResult(args.name);
		if (Result.isError(nameResult)) {
			throwResourceError(nameResult.error);
		}

		if (args.projectId) {
			const project = await ctx.db.get(args.projectId);
			if (!project || project.instanceId !== instance._id) {
				throwResourceError(
					new WebValidationError({ message: 'Project not found', field: 'projectId' })
				);
			}
		}

		const resourceId = await ctx.db.insert('userResources', {
			instanceId: instance._id,
			projectId: args.projectId,
			name: args.name,
			type: 'git',
			url: args.url,
			branch: args.branch,
			searchPath: args.searchPath,
			specialNotes: args.specialNotes,
			gitProvider: getGitProvider(args.url),
			visibility: 'public',
			createdAt: Date.now()
		});

		await ctx.scheduler.runAfter(0, instances.internalActions.syncResources, {
			instanceId: instance._id,
			projectId: args.projectId
		});

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.RESOURCE_ADDED,
			properties: {
				instanceId: instance._id,
				resourceId,
				resourceName: args.name,
				resourceUrl: args.url,
				resourceVisibility: 'public',
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
	returns: v.null(),
	handler: async (ctx, args) => {
		const { resource, instance } = await unwrapAuthResult(
			await requireUserResourceOwnershipResult(ctx, args.resourceId)
		);

		await ctx.db.delete(args.resourceId);

		await ctx.scheduler.runAfter(0, instances.internalActions.syncResources, {
			instanceId: resource.instanceId,
			projectId: resource.projectId
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

		return null;
	}
});

export const addCustomResourceInternal = internalMutation({
	args: {
		instanceId: v.id('instances'),
		projectId: v.optional(v.id('projects')),
		name: v.string(),
		type: v.union(v.literal('git'), v.literal('npm')),
		url: v.optional(v.string()),
		branch: v.optional(v.string()),
		package: v.optional(v.string()),
		version: v.optional(v.string()),
		searchPath: v.optional(v.string()),
		specialNotes: v.optional(v.string()),
		gitProvider: v.optional(v.union(v.literal('github'), v.literal('generic'))),
		visibility: v.optional(v.union(v.literal('public'), v.literal('private'))),
		authSource: v.optional(v.union(v.literal('clerk_github_oauth'), v.literal('github_app')))
	},
	returns: v.id('userResources'),
	handler: async (ctx, args) => {
		return await ctx.db.insert('userResources', {
			instanceId: args.instanceId,
			projectId: args.projectId,
			name: args.name,
			type: args.type,
			url: args.type === 'git' ? args.url : undefined,
			branch: args.type === 'git' ? (args.branch ?? 'main') : undefined,
			package: args.type === 'npm' ? args.package : undefined,
			version: args.type === 'npm' ? args.version : undefined,
			searchPath: args.type === 'git' ? args.searchPath : undefined,
			specialNotes: args.specialNotes,
			gitProvider: args.type === 'git' ? (args.gitProvider ?? getGitProvider(args.url)) : undefined,
			visibility: args.type === 'git' ? (args.visibility ?? 'public') : undefined,
			authSource: args.type === 'git' ? args.authSource : undefined,
			createdAt: Date.now()
		});
	}
});
