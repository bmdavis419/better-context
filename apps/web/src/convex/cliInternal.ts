import { v } from 'convex/values';

import type { Id } from './_generated/dataModel';
import { internalQuery } from './_generated/server';

// ─────────────────────────────────────────────────────────────────────────────
// Internal queries for CLI (must be in non-Node.js runtime)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List projects for an instance (internal)
 */
export const listProjectsInternal = internalQuery({
	args: {
		instanceId: v.id('instances')
	},
	handler: async (ctx, args) => {
		const projects = await ctx.db
			.query('projects')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();

		return projects
			.map((p) => ({
				_id: p._id as string,
				name: p.name,
				model: p.model,
				isDefault: p.isDefault,
				createdAt: p.createdAt
			}))
			.sort((a, b) => {
				if (a.isDefault && !b.isDefault) return -1;
				if (!a.isDefault && b.isDefault) return 1;
				return b.createdAt - a.createdAt;
			});
	}
});

/**
 * List threads for an instance (internal)
 */
export const listThreadsInternal = internalQuery({
	args: {
		instanceId: v.id('instances'),
		projectName: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		let threads = await ctx.db
			.query('threads')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();

		// Filter by project if specified
		if (args.projectName) {
			const project = await ctx.db
				.query('projects')
				.withIndex('by_instance_and_name', (q) =>
					q.eq('instanceId', args.instanceId).eq('name', args.projectName!)
				)
				.first();

			if (project) {
				threads = threads.filter((t) => t.projectId === project._id);
			} else {
				return [];
			}
		}

		return threads
			.map((t) => ({
				_id: t._id as string,
				title: t.title,
				createdAt: t.createdAt,
				lastActivityAt: t.lastActivityAt
			}))
			.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
	}
});

/**
 * Get thread with messages (internal)
 */
export const getThreadInternal = internalQuery({
	args: {
		instanceId: v.id('instances'),
		threadId: v.string()
	},
	handler: async (ctx, args) => {
		// Get thread
		const thread = await ctx.db.get(args.threadId as Id<'threads'>);
		if (!thread || thread.instanceId !== args.instanceId) {
			return null;
		}

		const messages = await ctx.db
			.query('messages')
			.withIndex('by_thread', (q) => q.eq('threadId', thread._id))
			.collect();

		return {
			thread: {
				_id: thread._id as string,
				title: thread.title,
				createdAt: thread.createdAt,
				lastActivityAt: thread.lastActivityAt
			},
			messages: messages
				.map((m) => ({
					_id: m._id as string,
					threadId: m.threadId as string,
					role: m.role,
					content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
					resources: m.resources,
					createdAt: m.createdAt
				}))
				.sort((a, b) => a.createdAt - b.createdAt)
		};
	}
});

/**
 * List MCP questions for a project (internal)
 */
export const listQuestionsInternal = internalQuery({
	args: {
		projectId: v.id('projects')
	},
	handler: async (ctx, args) => {
		const questions = await ctx.db
			.query('mcpQuestions')
			.withIndex('by_project', (q) => q.eq('projectId', args.projectId))
			.collect();

		return questions
			.map((q) => ({
				_id: q._id as string,
				projectId: q.projectId as string,
				question: q.question,
				resources: q.resources,
				answer: q.answer,
				createdAt: q.createdAt
			}))
			.sort((a, b) => b.createdAt - a.createdAt);
	}
});
