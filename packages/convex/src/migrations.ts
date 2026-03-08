import { Migrations } from '@convex-dev/migrations';
import { v } from 'convex/values';

import { components, internal } from './_generated/api';
import type { DataModel, Id } from './_generated/dataModel';
import { internalMutation, internalQuery } from './_generated/server';

// Initialize the migrations component
export const migrations = new Migrations<DataModel>(components.migrations);

// Runner for CLI/dashboard access
export const run = migrations.runner();

/**
 * Migration: Add projectId to threads that don't have one.
 *
 * For each thread without a projectId, finds or creates the default project
 * for its instance, then sets the projectId.
 */
export const migrateThreadsToProject = migrations.define({
	table: 'threads',
	customRange: (query) => query.filter((q) => q.eq(q.field('projectId'), undefined)),
	batchSize: 50,
	migrateOne: async (ctx, thread) => {
		// Get or create the default project for this instance
		const projectId = await getOrCreateDefaultProject(ctx, thread.instanceId);
		return { projectId };
	}
});

/**
 * Migration: Add projectId to userResources that don't have one.
 */
export const migrateUserResourcesToProject = migrations.define({
	table: 'userResources',
	customRange: (query) => query.filter((q) => q.eq(q.field('projectId'), undefined)),
	batchSize: 50,
	migrateOne: async (ctx, resource) => {
		const projectId = await getOrCreateDefaultProject(ctx, resource.instanceId);
		return { projectId };
	}
});

/**
 * Migration: Add projectId to cachedResources that don't have one.
 */
export const migrateCachedResourcesToProject = migrations.define({
	table: 'cachedResources',
	customRange: (query) => query.filter((q) => q.eq(q.field('projectId'), undefined)),
	batchSize: 50,
	migrateOne: async (ctx, resource) => {
		const projectId = await getOrCreateDefaultProject(ctx, resource.instanceId);
		return { projectId };
	}
});

/**
 * Helper: Get or create the default project for an instance.
 * Caches results within a single migration batch.
 */
const projectCache = new Map<string, Id<'projects'>>();

async function getOrCreateDefaultProject(
	ctx: {
		db: {
			query: (table: 'projects') => any;
			insert: (table: 'projects', doc: any) => Promise<Id<'projects'>>;
		};
	},
	instanceId: Id<'instances'>
): Promise<Id<'projects'>> {
	// Check cache first
	const cached = projectCache.get(instanceId);
	if (cached) return cached;

	// Look for existing default project
	const existing = await ctx.db
		.query('projects')
		.withIndex('by_instance_and_name', (q: any) =>
			q.eq('instanceId', instanceId).eq('name', 'default')
		)
		.first();

	if (existing) {
		projectCache.set(instanceId, existing._id);
		return existing._id;
	}

	// Create new default project
	const projectId = await ctx.db.insert('projects', {
		instanceId,
		name: 'default',
		isDefault: true,
		createdAt: Date.now()
	});

	projectCache.set(instanceId, projectId);
	return projectId;
}

/**
 * Runner for all Phase 3 migrations in sequence.
 * Run with: npx convex run migrations:runAll
 */
export const runAll = migrations.runner([
	internal.migrations.migrateThreadsToProject,
	internal.migrations.migrateUserResourcesToProject,
	internal.migrations.migrateCachedResourcesToProject
]);

// ============================================================================
// Status and utility functions
// ============================================================================

/**
 * Get the current migration status.
 * Shows counts of records that still need migration.
 */
export const getMigrationStatus = internalQuery({
	args: {},
	returns: v.object({
		totalInstances: v.number(),
		totalProjects: v.number(),
		threadsWithoutProject: v.number(),
		userResourcesWithoutProject: v.number(),
		cachedResourcesWithoutProject: v.number(),
		migrationComplete: v.boolean()
	}),
	handler: async (ctx) => {
		const totalInstances = (await ctx.db.query('instances').collect()).length;
		const totalProjects = (await ctx.db.query('projects').collect()).length;

		// Count records without projectId
		const threadsWithoutProject = (
			await ctx.db
				.query('threads')
				.filter((q) => q.eq(q.field('projectId'), undefined))
				.collect()
		).length;

		const userResourcesWithoutProject = (
			await ctx.db
				.query('userResources')
				.filter((q) => q.eq(q.field('projectId'), undefined))
				.collect()
		).length;

		const cachedResourcesWithoutProject = (
			await ctx.db
				.query('cachedResources')
				.filter((q) => q.eq(q.field('projectId'), undefined))
				.collect()
		).length;

		return {
			totalInstances,
			totalProjects,
			threadsWithoutProject,
			userResourcesWithoutProject,
			cachedResourcesWithoutProject,
			migrationComplete:
				threadsWithoutProject === 0 &&
				userResourcesWithoutProject === 0 &&
				cachedResourcesWithoutProject === 0
		};
	}
});

/**
 * Get instances that don't have a default project yet.
 */
export const getInstancesWithoutDefaultProject = internalQuery({
	args: {},
	returns: v.array(v.id('instances')),
	handler: async (ctx) => {
		const instances = await ctx.db.query('instances').collect();
		const results: Id<'instances'>[] = [];

		for (const instance of instances) {
			const defaultProject = await ctx.db
				.query('projects')
				.withIndex('by_instance_and_name', (q) =>
					q.eq('instanceId', instance._id).eq('name', 'default')
				)
				.first();

			if (!defaultProject) {
				results.push(instance._id);
			}
		}

		return results;
	}
});

/**
 * Create default projects for all instances that don't have one.
 * This can be run before or as part of the main migration.
 */
export const createMissingDefaultProjects = internalMutation({
	args: {},
	returns: v.object({
		created: v.number(),
		total: v.number()
	}),
	handler: async (ctx) => {
		const instances = await ctx.db.query('instances').collect();
		let created = 0;

		for (const instance of instances) {
			const existing = await ctx.db
				.query('projects')
				.withIndex('by_instance_and_name', (q) =>
					q.eq('instanceId', instance._id).eq('name', 'default')
				)
				.first();

			if (!existing) {
				await ctx.db.insert('projects', {
					instanceId: instance._id,
					name: 'default',
					isDefault: true,
					createdAt: Date.now()
				});
				created++;
			}
		}

		return { created, total: instances.length };
	}
});
