import { GLOBAL_RESOURCES, getResourceNameError } from '@btca/shared';
import { v } from 'convex/values';
import { Result } from 'better-result';
import { internalQuery, mutation, query } from './_generated/server';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { AnalyticsEvents } from './analyticsEvents';
import { instances } from './apiHelpers';
import {
	getAuthenticatedInstanceResult,
	requireUserResourceOwnershipResult,
	unwrapAuthResult
} from './authHelpers';
import { WebValidationError } from '../lib/result/errors';
import type { WebError } from '../lib/result/errors';

type ResourceNameResult = Result<string, WebValidationError>;

type GitCustomResource = {
	name: string;
	displayName: string;
	type: 'git';
	url: string;
	branch: string;
	searchPath?: string;
	specialNotes?: string;
	isGlobal: false;
};

type NpmCustomResource = {
	name: string;
	displayName: string;
	type: 'npm';
	package: string;
	version?: string;
	specialNotes?: string;
	isGlobal: false;
};

type CustomResource = GitCustomResource | NpmCustomResource;

const NPM_PACKAGE_SEGMENT_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
const NPM_VERSION_OR_TAG_REGEX = /^[^\s/]+$/;

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

const isValidNpmPackage = (value: string) => {
	if (!value) return false;
	if (value.startsWith('@')) {
		const parts = value.split('/');
		return (
			parts.length === 2 &&
			parts[0] !== '@' &&
			NPM_PACKAGE_SEGMENT_REGEX.test(parts[0]!.slice(1)) &&
			NPM_PACKAGE_SEGMENT_REGEX.test(parts[1]!)
		);
	}
	return !value.includes('/') && NPM_PACKAGE_SEGMENT_REGEX.test(value);
};

const mapGlobalResource = (resource: (typeof GLOBAL_RESOURCES)[number]) => ({
	name: resource.name,
	displayName: resource.displayName,
	type: 'git' as const,
	url: resource.url,
	branch: resource.branch,
	searchPath: resource.searchPath ?? resource.searchPaths?.[0],
	specialNotes: resource.specialNotes,
	isGlobal: true as const
});

const mapUserResource = (resource: {
	name: string;
	type: 'git' | 'npm';
	url?: string;
	branch?: string;
	searchPath?: string;
	package?: string;
	version?: string;
	specialNotes?: string;
}): CustomResource => {
	if (resource.type === 'npm') {
		return {
			name: resource.name,
			displayName: resource.name,
			type: 'npm',
			package: resource.package ?? '',
			version: resource.version,
			specialNotes: resource.specialNotes,
			isGlobal: false
		};
	}

	return {
		name: resource.name,
		displayName: resource.name,
		type: 'git',
		url: resource.url ?? '',
		branch: resource.branch ?? 'main',
		searchPath: resource.searchPath,
		specialNotes: resource.specialNotes,
		isGlobal: false
	};
};

const globalResourceValidator = v.object({
	name: v.string(),
	displayName: v.string(),
	type: v.literal('git'),
	url: v.string(),
	branch: v.string(),
	searchPath: v.optional(v.string()),
	specialNotes: v.optional(v.string()),
	isGlobal: v.literal(true)
});

const gitCustomResourceValidator = v.object({
	name: v.string(),
	displayName: v.string(),
	type: v.literal('git'),
	url: v.string(),
	branch: v.string(),
	searchPath: v.optional(v.string()),
	specialNotes: v.optional(v.string()),
	isGlobal: v.literal(false)
});

const npmCustomResourceValidator = v.object({
	name: v.string(),
	displayName: v.string(),
	type: v.literal('npm'),
	package: v.string(),
	version: v.optional(v.string()),
	specialNotes: v.optional(v.string()),
	isGlobal: v.literal(false)
});

const customResourceValidator = v.union(gitCustomResourceValidator, npmCustomResourceValidator);

const gitUserResourceValidator = v.object({
	_id: v.id('userResources'),
	_creationTime: v.number(),
	instanceId: v.id('instances'),
	projectId: v.optional(v.id('projects')),
	name: v.string(),
	type: v.literal('git'),
	url: v.optional(v.string()),
	branch: v.optional(v.string()),
	searchPath: v.optional(v.string()),
	package: v.optional(v.string()),
	version: v.optional(v.string()),
	specialNotes: v.optional(v.string()),
	createdAt: v.number()
});

const npmUserResourceValidator = v.object({
	_id: v.id('userResources'),
	_creationTime: v.number(),
	instanceId: v.id('instances'),
	projectId: v.optional(v.id('projects')),
	name: v.string(),
	type: v.literal('npm'),
	url: v.optional(v.string()),
	branch: v.optional(v.string()),
	searchPath: v.optional(v.string()),
	package: v.optional(v.string()),
	version: v.optional(v.string()),
	specialNotes: v.optional(v.string()),
	createdAt: v.number()
});

const userResourceValidator = v.union(gitUserResourceValidator, npmUserResourceValidator);

const addCustomResourceArgs = {
	name: v.string(),
	type: v.optional(v.union(v.literal('git'), v.literal('npm'))),
	url: v.optional(v.string()),
	branch: v.optional(v.string()),
	searchPath: v.optional(v.string()),
	package: v.optional(v.string()),
	version: v.optional(v.string()),
	specialNotes: v.optional(v.string()),
	projectId: v.optional(v.id('projects'))
};

const resolveAddCustomResourceInput = (args: {
	name: string;
	type?: 'git' | 'npm';
	url?: string;
	branch?: string;
	searchPath?: string;
	package?: string;
	version?: string;
	specialNotes?: string;
	projectId?: Id<'projects'>;
}) => {
	const requestedType = args.type;
	const hasGitFields =
		typeof args.url === 'string' ||
		typeof args.branch === 'string' ||
		typeof args.searchPath === 'string';
	const hasNpmFields = typeof args.package === 'string' || typeof args.version === 'string';

	if (!requestedType && hasGitFields && hasNpmFields) {
		throw new WebValidationError({
			message:
				'Ambiguous resource payload. Set "type" to "git" or "npm" when sending both git and npm fields.',
			field: 'type'
		});
	}

	const type = requestedType ?? (hasNpmFields ? 'npm' : 'git');

	if (type === 'git') {
		if (hasNpmFields) {
			throw new WebValidationError({
				message: 'Git resources cannot include npm package or version fields',
				field: 'type'
			});
		}
		if (!args.url?.trim()) {
			throw new WebValidationError({ message: 'Git URL is required', field: 'url' });
		}
		let parsedUrl: URL;
		try {
			parsedUrl = new URL(args.url);
		} catch {
			throw new WebValidationError({ message: 'Invalid URL format', field: 'url' });
		}
		if (parsedUrl.protocol !== 'https:') {
			throw new WebValidationError({ message: 'URL must be an HTTPS URL', field: 'url' });
		}

		return {
			type: 'git' as const,
			name: args.name,
			url: args.url.trim(),
			branch: args.branch?.trim() || 'main',
			searchPath: args.searchPath,
			specialNotes: args.specialNotes,
			projectId: args.projectId
		};
	}

	if (hasGitFields) {
		throw new WebValidationError({
			message: 'npm resources cannot include git URL/branch/searchPath fields',
			field: 'type'
		});
	}

	const packageName = args.package?.trim();
	if (!packageName) {
		throw new WebValidationError({ message: 'npm package is required', field: 'package' });
	}
	if (!isValidNpmPackage(packageName)) {
		throw new WebValidationError({
			message: 'npm package must be a valid package name (for example react or @types/node)',
			field: 'package'
		});
	}
	if (args.version && !NPM_VERSION_OR_TAG_REGEX.test(args.version)) {
		throw new WebValidationError({
			message: 'npm version/tag must not contain spaces or "/"',
			field: 'version'
		});
	}

	return {
		type: 'npm' as const,
		name: args.name,
		package: packageName,
		version: args.version?.trim() || undefined,
		specialNotes: args.specialNotes,
		projectId: args.projectId
	};
};

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

		return {
			global: GLOBAL_RESOURCES.map(mapGlobalResource),
			custom: userResources.map(mapUserResource)
		};
	}
});

/**
 * Check if a resource name exists within a specific project (case-insensitive)
 */
export const resourceExistsInProject = internalQuery({
	args: {
		projectId: v.id('projects'),
		name: v.string()
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		const projectResources = await ctx.db
			.query('userResources')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();

		return projectResources.some((r) => r.name.toLowerCase() === args.name.toLowerCase());
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
		return await ctx.db
			.query('userResources')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();
	}
});

/**
 * Internal version that accepts instanceId (for use by internal actions only)
 * This is needed for server-side operations that run without user auth context
 */
export const listAvailableInternal = internalQuery({
	args: { instanceId: v.id('instances') },
	returns: v.object({
		global: v.array(globalResourceValidator),
		custom: v.array(customResourceValidator)
	}),
	handler: async (ctx, args) => {
		const userResources = await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();

		return {
			global: GLOBAL_RESOURCES.map(mapGlobalResource),
			custom: userResources.map(mapUserResource)
		};
	}
});

/**
 * Internal version that filters by project (for use by internal actions only)
 * Returns global resources plus custom resources for the specific project
 */
export const listAvailableForProject = internalQuery({
	args: {
		projectId: v.id('projects')
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

		return {
			global: GLOBAL_RESOURCES.map(mapGlobalResource),
			custom: userResources.map(mapUserResource)
		};
	}
});

/**
 * Add a custom resource to the authenticated user's instance
 */
export const addCustomResource = mutation({
	args: addCustomResourceArgs,
	returns: v.id('userResources'),
	handler: async (ctx, args) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));
		const nameResult = validateResourceNameResult(args.name);
		if (Result.isError(nameResult)) {
			throwResourceError(nameResult.error);
		}

		const resourceInput = resolveAddCustomResourceInput(args);
		const requestedName = resourceInput.name.toLowerCase();
		const scopedResources = resourceInput.projectId
			? (
					await ctx.db
						.query('userResources')
						.withIndex('by_project', (q) => q.eq('projectId', resourceInput.projectId))
						.collect()
				).filter((resource) => resource.instanceId === instance._id)
			: (
					await ctx.db
						.query('userResources')
						.withIndex('by_instance', (q) => q.eq('instanceId', instance._id))
						.collect()
				).filter((resource) => resource.projectId === undefined);
		const nameExists = scopedResources.some(
			(resource) => resource.name.toLowerCase() === requestedName
		);
		if (nameExists) {
			throw new WebValidationError({
				message: `Resource "${resourceInput.name}" already exists in this project`,
				field: 'name'
			});
		}

		const resourceId = await ctx.db.insert('userResources', {
			instanceId: instance._id,
			projectId: resourceInput.projectId,
			name: resourceInput.name,
			type: resourceInput.type,
			...(resourceInput.type === 'git'
				? {
						url: resourceInput.url,
						branch: resourceInput.branch,
						searchPath: resourceInput.searchPath,
						specialNotes: resourceInput.specialNotes
					}
				: {
						package: resourceInput.package,
						version: resourceInput.version,
						specialNotes: resourceInput.specialNotes
					}),
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
				resourceName: resourceInput.name,
				resourceType: resourceInput.type,
				hasNotes: !!resourceInput.specialNotes,
				...(resourceInput.type === 'git'
					? {
							resourceUrl: resourceInput.url,
							hasBranch: resourceInput.branch !== 'main',
							hasSearchPath: !!resourceInput.searchPath
						}
					: {
							resourcePackage: resourceInput.package,
							hasVersion: !!resourceInput.version
						})
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
			instanceId: resource.instanceId
		});

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.RESOURCE_REMOVED,
			properties: {
				instanceId: resource.instanceId,
				resourceId: args.resourceId,
				resourceName: resource.name,
				resourceType: resource.type
			}
		});

		return null;
	}
});
