import { v } from 'convex/values';
import { Result } from 'better-result';

import type { Id } from './_generated/dataModel';
import { internalMutation } from './_generated/server';
import { isWebSandboxModelId } from './lib/models/webSandboxModels.ts';
import { WebConflictError, WebValidationError, type WebError } from './lib/result/errors';

type McpInternalResult<T> = Result<T, WebError>;

const throwMcpInternalError = (error: WebError): never => {
	throw error;
};

const getGitProvider = (url: string): 'github' | 'generic' => {
	try {
		return new URL(url).hostname.toLowerCase() === 'github.com' ? 'github' : 'generic';
	} catch {
		return 'generic';
	}
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
		// Double-check it doesn't exist (race condition protection)
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
		url: v.string(),
		branch: v.string(),
		searchPath: v.optional(v.string()),
		specialNotes: v.optional(v.string())
	},
	returns: v.id('userResources'),
	handler: async (ctx, args): Promise<Id<'userResources'>> => {
		const existing = await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();

		if (existing.some((resource) => resource.name.toLowerCase() === args.name.toLowerCase())) {
			const result: McpInternalResult<Id<'userResources'>> = Result.err(
				new WebConflictError({
					message: `Resource "${args.name}" already exists in this instance`,
					conflict: args.name
				})
			);
			throwMcpInternalError(result.error);
		}

		return await ctx.db.insert('userResources', {
			instanceId: args.instanceId,
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
	}
});

/**
 * Internal mutation to update a resource (used by MCP sync)
 */
export const updateResourceInternal = internalMutation({
	args: {
		instanceId: v.id('instances'),
		projectId: v.id('projects'),
		name: v.string(),
		url: v.string(),
		branch: v.string(),
		searchPath: v.optional(v.string()),
		specialNotes: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		// Use compound index for efficient lookup by project
		const existing = await ctx.db
			.query('userResources')
			.withIndex('by_project_and_name', (q) =>
				q.eq('projectId', args.projectId).eq('name', args.name)
			)
			.first();

		if (!existing) {
			const result: McpInternalResult<null> = Result.err(
				new WebValidationError({
					message: `Resource "${args.name}" not found in this project`,
					field: 'name'
				})
			);
			throwMcpInternalError(result.error);
		}
		await ctx.db.patch(existing!._id, {
			url: args.url,
			branch: args.branch,
			searchPath: args.searchPath,
			specialNotes: args.specialNotes,
			gitProvider: getGitProvider(args.url),
			visibility: 'public',
			authSource: undefined
		});
		return null;
	}
});

/**
 * Internal mutation to update a project's model (used by MCP sync)
 */
export const updateProjectModelInternal = internalMutation({
	args: {
		projectId: v.id('projects'),
		model: v.string()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		if (!isWebSandboxModelId(args.model)) {
			throwMcpInternalError(
				new WebValidationError({ message: 'Unsupported model', field: 'model' })
			);
		}

		await ctx.db.patch(args.projectId, {
			model: args.model
		});
		return null;
	}
});
