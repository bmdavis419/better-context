import { v } from 'convex/values';

import type { Id } from './_generated/dataModel';
import { internalMutation } from './_generated/server';

/**
 * Internal mutation to create a project (used by MCP to avoid auth requirements)
 */
export const createProjectInternal = internalMutation({
	args: {
		instanceId: v.id('instances'),
		name: v.string(),
		isDefault: v.boolean()
	},
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
	handler: async (ctx, args): Promise<Id<'userResources'>> => {
		// Check if resource with this name already exists for this instance
		const existing = await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.filter((q) => q.eq(q.field('name'), args.name))
			.first();

		if (existing) {
			throw new Error(`Resource "${args.name}" already exists`);
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
		name: v.string(),
		url: v.string(),
		branch: v.string(),
		searchPath: v.optional(v.string()),
		specialNotes: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('userResources')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.filter((q) => q.eq(q.field('name'), args.name))
			.first();

		if (!existing) {
			throw new Error(`Resource "${args.name}" not found`);
		}

		await ctx.db.patch(existing._id, {
			url: args.url,
			branch: args.branch,
			searchPath: args.searchPath,
			specialNotes: args.specialNotes
		});
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
	handler: async (ctx, args) => {
		await ctx.db.patch(args.projectId, {
			model: args.model
		});
	}
});
