import { v } from 'convex/values';
import { Result } from 'better-result';

import type { Id } from './_generated/dataModel';
import { internalMutation } from './_generated/server';
import { WebConflictError, WebValidationError, type WebError } from '../lib/result/errors';

type McpInternalResult<T> = Result<T, WebError>;

const NPM_PACKAGE_SEGMENT_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
const NPM_VERSION_OR_TAG_REGEX = /^[^\s/]+$/;

const throwMcpInternalError = (error: WebError): never => {
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

const resolveMcpResourceInput = (args: {
	type?: 'git' | 'npm';
	name: string;
	url?: string;
	branch?: string;
	searchPath?: string;
	package?: string;
	version?: string;
	specialNotes?: string;
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
			specialNotes: args.specialNotes
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
		specialNotes: args.specialNotes
	};
};

/**
 * Internal mutation to create a project (used by MCP to avoid auth requirements)
 */
export const createProjectInternal = internalMutation({
	args: {
		instanceId: v.id('instances'),
		name: v.string(),
		isDefault: v.boolean()
	},
	returns: v.id('projects'),
	handler: async (ctx, args): Promise<Id<'projects'>> => {
		const existing = await ctx.db
			.query('projects')
			.withIndex('by_instance_and_name', (q) =>
				q.eq('instanceId', args.instanceId).eq('name', args.name)
			)
			.first();

		if (existing) {
			return existing._id;
		}

		return await ctx.db.insert('projects', {
			instanceId: args.instanceId,
			name: args.name,
			isDefault: args.isDefault,
			createdAt: Date.now()
		});
	}
});

/**
 * Internal mutation to record an MCP question
 */
export const recordQuestion = internalMutation({
	args: {
		projectId: v.id('projects'),
		question: v.string(),
		resources: v.array(v.string()),
		answer: v.string()
	},
	returns: v.id('mcpQuestions'),
	handler: async (ctx, args) => {
		return await ctx.db.insert('mcpQuestions', {
			projectId: args.projectId,
			question: args.question,
			resources: args.resources,
			answer: args.answer,
			createdAt: Date.now()
		});
	}
});

/**
 * Internal mutation to add a resource (used by MCP to avoid auth requirements)
 */
export const addResourceInternal = internalMutation({
	args: {
		instanceId: v.id('instances'),
		projectId: v.id('projects'),
		name: v.string(),
		type: v.optional(v.union(v.literal('git'), v.literal('npm'))),
		url: v.optional(v.string()),
		branch: v.optional(v.string()),
		searchPath: v.optional(v.string()),
		package: v.optional(v.string()),
		version: v.optional(v.string()),
		specialNotes: v.optional(v.string())
	},
	returns: v.id('userResources'),
	handler: async (ctx, args): Promise<Id<'userResources'>> => {
		const existing = await ctx.db
			.query('userResources')
			.withIndex('by_project_and_name', (q) =>
				q.eq('projectId', args.projectId).eq('name', args.name)
			)
			.first();

		if (existing) {
			const result: McpInternalResult<Id<'userResources'>> = Result.err(
				new WebConflictError({
					message: `Resource "${args.name}" already exists in this project`,
					conflict: args.name
				})
			);
			throwMcpInternalError(result.error);
		}

		const resourceInput = resolveMcpResourceInput(args);

		return await ctx.db.insert('userResources', {
			instanceId: args.instanceId,
			projectId: args.projectId,
			name: args.name,
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
	}
});
