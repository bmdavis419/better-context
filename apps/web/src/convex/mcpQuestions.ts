import { v } from 'convex/values';

import { query } from './_generated/server';
import { getAuthenticatedInstance } from './authHelpers';

/**
 * List MCP questions for a project.
 * Returns questions in reverse chronological order (newest first).
 */
export const list = query({
	args: {
		projectId: v.id('projects'),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);
		const limit = args.limit ?? 50;

		// Verify the project belongs to this instance
		const project = await ctx.db.get(args.projectId);
		if (!project || project.instanceId !== instance._id) {
			throw new Error('Project not found');
		}

		const questions = await ctx.db
			.query('mcpQuestions')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.take(limit);

		// Sort by createdAt descending (newest first)
		return questions.sort((a, b) => b.createdAt - a.createdAt);
	}
});

/**
 * List MCP questions for the default project of the authenticated user's instance.
 * Convenience method when no specific project is specified.
 */
export const listForDefaultProject = query({
	args: {
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);
		const limit = args.limit ?? 50;

		// Find the default project
		const defaultProject = await ctx.db
			.query('projects')
			.withIndex('by_instance_and_name', (q) =>
				q.eq('instanceId', instance._id).eq('name', 'default')
			)
			.first();

		if (!defaultProject) {
			// No default project yet, return empty list
			return [];
		}

		const questions = await ctx.db
			.query('mcpQuestions')
			.withIndex('by_project', (q) => q.eq('projectId', defaultProject._id))
			.take(limit);

		// Sort by createdAt descending (newest first)
		return questions.sort((a, b) => b.createdAt - a.createdAt);
	}
});

/**
 * Get a specific MCP question by ID (requires ownership through project -> instance)
 */
export const get = query({
	args: { questionId: v.id('mcpQuestions') },
	handler: async (ctx, args) => {
		const instance = await getAuthenticatedInstance(ctx);

		const question = await ctx.db.get(args.questionId);
		if (!question) {
			return null;
		}

		// Verify ownership through project
		const project = await ctx.db.get(question.projectId);
		if (!project || project.instanceId !== instance._id) {
			return null;
		}

		return question;
	}
});
