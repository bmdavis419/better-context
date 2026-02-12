import { v } from 'convex/values';
import { Result } from 'better-result';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalQuery, mutation, query } from './_generated/server';
import { AnalyticsEvents } from './analyticsEvents';
import { getAuthenticatedInstanceResult, unwrapAuthResult } from './authHelpers';
import { WebConflictError, WebValidationError, type WebError } from '../lib/result/errors';

// Project validator
const projectValidator = v.object({
	_id: v.id('projects'),
	_creationTime: v.number(),
	instanceId: v.id('instances'),
	name: v.string(),
	model: v.optional(v.string()),
	isDefault: v.boolean(),
	createdAt: v.number()
});

type ProjectResult<T> = Result<T, WebError>;

const throwProjectError = (error: WebError): never => {
	throw error;
};

const projectNotFoundError = (message: string): WebValidationError =>
	new WebValidationError({ message, field: 'project' });

type ProjectDb = {
	get(id: Id<'projects'>): Promise<Doc<'projects'> | null>;
};

type DbCtx = { db: ProjectDb };

const requireProjectOwnershipResult = async (
	ctx: DbCtx,
	projectId: Id<'projects'>,
	instanceId: Id<'instances'>
): Promise<ProjectResult<Doc<'projects'>>> => {
	const project = await ctx.db.get(projectId);
	if (!project || project.instanceId !== instanceId) {
		return Result.err(projectNotFoundError('Project not found'));
	}
	return Result.ok(project);
};

/**
 * List all projects for the authenticated user's instance
 */
export const list = query({
	args: {},
	returns: v.array(projectValidator),
	handler: async (ctx) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));

		const projects = await ctx.db
			.query('projects')
			.withIndex('by_instance', (q) => q.eq('instanceId', instance._id))
			.collect();

		return projects.sort((a, b) => {
			// Default project always first
			if (a.isDefault && !b.isDefault) return -1;
			if (!a.isDefault && b.isDefault) return 1;
			// Then by creation date (newest first)
			return b.createdAt - a.createdAt;
		});
	}
});

/**
 * Get a project by name for the authenticated user's instance
 */
export const getByName = query({
	args: { name: v.string() },
	returns: v.union(v.null(), projectValidator),
	handler: async (ctx, args) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));

		return await ctx.db
			.query('projects')
			.withIndex('by_instance_and_name', (q) =>
				q.eq('instanceId', instance._id).eq('name', args.name)
			)
			.first();
	}
});

/**
 * Get a project by ID (requires ownership through instance)
 */
export const get = query({
	args: { projectId: v.id('projects') },
	returns: v.union(v.null(), projectValidator),
	handler: async (ctx, args) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));
		const project = await ctx.db.get(args.projectId);

		if (!project || project.instanceId !== instance._id) {
			return null;
		}

		return project;
	}
});

/**
 * Get the default project for the authenticated user's instance.
 * Creates one if it doesn't exist.
 */
export const getDefault = query({
	args: {},
	returns: v.union(v.null(), projectValidator),
	handler: async (ctx) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));

		const defaultProject = await ctx.db
			.query('projects')
			.withIndex('by_instance_and_name', (q) =>
				q.eq('instanceId', instance._id).eq('name', 'default')
			)
			.first();

		return defaultProject;
	}
});

/**
 * Create a new project for the authenticated user's instance
 */
export const create = mutation({
	args: {
		name: v.string(),
		model: v.optional(v.string())
	},
	returns: v.id('projects'),
	handler: async (ctx, args) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));
		const existing = await ctx.db
			.query('projects')
			.withIndex('by_instance_and_name', (q) =>
				q.eq('instanceId', instance._id).eq('name', args.name)
			)
			.first();

		const hasExistingProject: ProjectResult<boolean> = existing
			? Result.err(
					new WebConflictError({
						message: `Project with name "${args.name}" already exists`,
						conflict: args.name
					})
				)
			: Result.ok(true);
		if (Result.isError(hasExistingProject)) {
			throwProjectError(hasExistingProject.error);
		}

		const projectId = await ctx.db.insert('projects', {
			instanceId: instance._id,
			name: args.name,
			model: args.model,
			isDefault: false,
			createdAt: Date.now()
		});

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.PROJECT_CREATED,
			properties: {
				instanceId: instance._id,
				projectId,
				projectName: args.name,
				hasModel: !!args.model
			}
		});

		return projectId;
	}
});

/**
 * Ensure the default project exists for an instance.
 * Creates it if it doesn't exist. Idempotent.
 */
export const ensureDefault = mutation({
	args: {},
	returns: v.id('projects'),
	handler: async (ctx): Promise<Id<'projects'>> => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));

		// Check if default project exists
		const existing = await ctx.db
			.query('projects')
			.withIndex('by_instance_and_name', (q) =>
				q.eq('instanceId', instance._id).eq('name', 'default')
			)
			.first();

		if (existing) {
			return existing._id;
		}

		// Create the default project
		const projectId = await ctx.db.insert('projects', {
			instanceId: instance._id,
			name: 'default',
			isDefault: true,
			createdAt: Date.now()
		});

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.PROJECT_CREATED,
			properties: {
				instanceId: instance._id,
				projectId,
				projectName: 'default',
				isDefault: true
			}
		});

		return projectId;
	}
});

/**
 * Update a project's model setting
 */
export const updateModel = mutation({
	args: {
		projectId: v.id('projects'),
		model: v.optional(v.string())
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));
		const projectResult = await requireProjectOwnershipResult(ctx, args.projectId, instance._id);
		Result.match(projectResult, {
			ok: () => undefined,
			err: (error) => throwProjectError(error)
		});

		await ctx.db.patch(args.projectId, { model: args.model });
		return null;
	}
});

/**
 * Delete a project (cannot delete the default project)
 */
export const remove = mutation({
	args: { projectId: v.id('projects') },
	returns: v.null(),
	handler: async (ctx, args) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));
		const projectResult = await requireProjectOwnershipResult(ctx, args.projectId, instance._id);
		const project = Result.match(projectResult, {
			ok: (value) => value,
			err: (error) => throwProjectError(error)
		});

		if (project.isDefault) {
			throwProjectError(
				new WebValidationError({ message: 'Cannot delete the default project', field: 'project' })
			);
		}

		// Delete all related threads
		const threads = await ctx.db
			.query('threads')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();

		for (const thread of threads) {
			// Delete messages for this thread
			const messages = await ctx.db
				.query('messages')
				.withIndex('by_thread', (q) => q.eq('threadId', thread._id))
				.collect();

			for (const message of messages) {
				await ctx.db.delete(message._id);
			}

			// Delete thread resources
			const threadResources = await ctx.db
				.query('threadResources')
				.withIndex('by_thread', (q) => q.eq('threadId', thread._id))
				.collect();

			for (const resource of threadResources) {
				await ctx.db.delete(resource._id);
			}

			await ctx.db.delete(thread._id);
		}

		// Delete all related userResources
		const userResources = await ctx.db
			.query('userResources')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();

		for (const resource of userResources) {
			await ctx.db.delete(resource._id);
		}

		// Delete all related cachedResources
		const cachedResources = await ctx.db
			.query('cachedResources')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();

		for (const resource of cachedResources) {
			await ctx.db.delete(resource._id);
		}

		// Delete all related mcpQuestions
		const mcpQuestions = await ctx.db
			.query('mcpQuestions')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();

		for (const question of mcpQuestions) {
			await ctx.db.delete(question._id);
		}

		// Finally delete the project
		await ctx.db.delete(args.projectId);

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.PROJECT_DELETED,
			properties: {
				instanceId: instance._id,
				projectId: args.projectId,
				projectName: project.name,
				deletedThreads: threads.length,
				deletedUserResources: userResources.length
			}
		});

		return null;
	}
});

/**
 * Internal query to get project by instance ID and name
 * Used by MCP and other internal operations
 */
export const getByInstanceAndName = internalQuery({
	args: {
		instanceId: v.id('instances'),
		name: v.string()
	},
	returns: v.union(v.null(), projectValidator),
	handler: async (ctx, args) => {
		return await ctx.db
			.query('projects')
			.withIndex('by_instance_and_name', (q) =>
				q.eq('instanceId', args.instanceId).eq('name', args.name)
			)
			.first();
	}
});

/**
 * Internal query to get default project by instance ID
 */
export const getDefaultByInstance = internalQuery({
	args: { instanceId: v.id('instances') },
	returns: v.union(v.null(), projectValidator),
	handler: async (ctx, args) => {
		return await ctx.db
			.query('projects')
			.withIndex('by_instance_and_name', (q) =>
				q.eq('instanceId', args.instanceId).eq('name', 'default')
			)
			.first();
	}
});

// MCP question validator
const mcpQuestionValidator = v.object({
	_id: v.id('mcpQuestions'),
	question: v.string(),
	resources: v.array(v.string()),
	answer: v.string(),
	createdAt: v.number()
});

/**
 * List MCP questions for a project
 */
export const listQuestions = query({
	args: {
		projectId: v.id('projects'),
		page: v.optional(v.number()),
		pageSize: v.optional(v.number()),
		resource: v.optional(v.string()),
		sort: v.optional(v.union(v.literal('asc'), v.literal('desc'))),
		search: v.optional(v.string())
	},
	returns: v.object({
		page: v.number(),
		pageSize: v.number(),
		total: v.number(),
		totalAll: v.number(),
		totalPages: v.number(),
		resources: v.array(v.object({ name: v.string(), count: v.number() })),
		items: v.array(mcpQuestionValidator)
	}),
	handler: async (ctx, args) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));
		const project = await ctx.db.get(args.projectId);

		if (!project || project.instanceId !== instance._id) {
			return {
				page: 1,
				pageSize: 20,
				total: 0,
				totalAll: 0,
				totalPages: 1,
				resources: [],
				items: []
			};
		}

		const pageSize = Math.min(Math.max(args.pageSize ?? 20, 10), 100);
		const requestedPage = Math.max(1, args.page ?? 1);
		const sort = args.sort ?? 'desc';
		const resourceFilter = (args.resource ?? '').trim();
		const search = (args.search ?? '').trim().toLowerCase();

		const questions = await ctx.db
			.query('mcpQuestions')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();

		const searchFiltered = search
			? questions.filter((question) => {
					const text = `${question.question}\n${question.answer}`.toLowerCase();
					return (
						text.includes(search) ||
						question.resources.some((resource) => resource.toLowerCase().includes(search))
					);
				})
			: questions;

		const resourceCounts = new Map<string, number>();
		for (const question of searchFiltered) {
			for (const resource of question.resources) {
				resourceCounts.set(resource, (resourceCounts.get(resource) ?? 0) + 1);
			}
		}

		const resources = Array.from(resourceCounts.entries())
			.map(([name, count]) => ({ name, count }))
			.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

		const filtered = resourceFilter
			? searchFiltered.filter((question) => question.resources.includes(resourceFilter))
			: searchFiltered;

		const sorted = filtered
			.slice()
			.sort((a, b) => (sort === 'asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));

		const total = sorted.length;
		const totalPages = Math.max(1, Math.ceil(total / pageSize));
		const page = Math.min(requestedPage, totalPages);
		const start = (page - 1) * pageSize;
		const items = sorted.slice(start, start + pageSize).map((question) => ({
			_id: question._id,
			question: question.question,
			resources: question.resources,
			answer: question.answer,
			createdAt: question.createdAt
		}));

		return {
			page,
			pageSize,
			total,
			totalAll: questions.length,
			totalPages,
			resources,
			items
		};
	}
});
