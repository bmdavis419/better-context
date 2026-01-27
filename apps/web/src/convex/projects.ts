import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalQuery, mutation, query } from './_generated/server';
import { AnalyticsEvents } from './analyticsEvents';
import { getAuthenticatedInstance } from './authHelpers';

/**
 * List all projects for the authenticated user's instance
 */
export const list = query({
	args: {},
	handler: async (ctx) => {
		const instance = await getAuthenticatedInstance(ctx);

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
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);

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
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);
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
	handler: async (ctx) => {
		const instance = await getAuthenticatedInstance(ctx);

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
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);

		// Check if project with this name already exists
		const existing = await ctx.db
			.query('projects')
			.withIndex('by_instance_and_name', (q) =>
				q.eq('instanceId', instance._id).eq('name', args.name)
			)
			.first();

		if (existing) {
			throw new Error(`Project with name "${args.name}" already exists`);
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
	handler: async (ctx): Promise<Id<'projects'>> => {
		const instance = await getAuthenticatedInstance(ctx);

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
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);
		const project = await ctx.db.get(args.projectId);

		if (!project || project.instanceId !== instance._id) {
			throw new Error('Project not found');
		}

		await ctx.db.patch(args.projectId, { model: args.model });
	}
});

/**
 * Delete a project (cannot delete the default project)
 */
export const remove = mutation({
	args: { projectId: v.id('projects') },
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);
		const project = await ctx.db.get(args.projectId);

		if (!project || project.instanceId !== instance._id) {
			throw new Error('Project not found');
		}

		if (project.isDefault) {
			throw new Error('Cannot delete the default project');
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
	handler: async (ctx, args) => {
		return await ctx.db
			.query('projects')
			.withIndex('by_instance_and_name', (q) =>
				q.eq('instanceId', args.instanceId).eq('name', 'default')
			)
			.first();
	}
});

/**
 * List MCP questions for a project
 */
export const listQuestions = query({
	args: { projectId: v.id('projects') },
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);
		const project = await ctx.db.get(args.projectId);

		if (!project || project.instanceId !== instance._id) {
			return [];
		}

		const questions = await ctx.db
			.query('mcpQuestions')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();

		return questions
			.map((q) => ({
				_id: q._id,
				question: q.question,
				resources: q.resources,
				answer: q.answer,
				createdAt: q.createdAt
			}))
			.sort((a, b) => b.createdAt - a.createdAt);
	}
});
