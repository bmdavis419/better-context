import { v } from 'convex/values';

import { internalMutation, internalQuery, query } from './_generated/server';
import { getAuthenticatedInstanceResult, unwrapAuthResult } from './authHelpers';

const githubInstallationValidator = v.object({
	_id: v.id('githubInstallations'),
	_creationTime: v.number(),
	instanceId: v.id('instances'),
	clerkUserId: v.string(),
	installationId: v.number(),
	accountLogin: v.string(),
	accountType: v.union(v.literal('User'), v.literal('Organization')),
	targetType: v.union(v.literal('User'), v.literal('Organization')),
	repositorySelection: v.union(v.literal('all'), v.literal('selected')),
	repositoryIds: v.array(v.number()),
	repositoryNames: v.array(v.string()),
	contentsPermission: v.optional(v.string()),
	metadataPermission: v.optional(v.string()),
	htmlUrl: v.optional(v.string()),
	status: v.union(v.literal('active'), v.literal('suspended'), v.literal('deleted')),
	connectedAt: v.number(),
	lastSyncedAt: v.number(),
	suspendedAt: v.optional(v.number())
});

const githubConnectionSummaryValidator = v.object({
	status: v.union(v.literal('connected'), v.literal('disconnected')),
	installations: v.array(
		v.object({
			installationId: v.number(),
			accountLogin: v.string(),
			accountType: v.union(v.literal('User'), v.literal('Organization')),
			targetType: v.union(v.literal('User'), v.literal('Organization')),
			repositorySelection: v.union(v.literal('all'), v.literal('selected')),
			repositoryIds: v.array(v.number()),
			repositoryNames: v.array(v.string()),
			contentsPermission: v.optional(v.string()),
			metadataPermission: v.optional(v.string()),
			htmlUrl: v.optional(v.string()),
			status: v.union(v.literal('active'), v.literal('suspended'), v.literal('deleted')),
			connectedAt: v.number(),
			lastSyncedAt: v.number(),
			suspendedAt: v.optional(v.number())
		})
	),
	connectedAt: v.optional(v.number()),
	lastSyncedAt: v.optional(v.number())
});

const toSummary = (
	installations: Array<{
		_id?: unknown;
		_creationTime?: number;
		instanceId?: unknown;
		clerkUserId?: string;
		installationId: number;
		accountLogin: string;
		accountType: 'User' | 'Organization';
		targetType: 'User' | 'Organization';
		repositorySelection: 'all' | 'selected';
		repositoryIds: number[];
		repositoryNames: string[];
		contentsPermission?: string;
		metadataPermission?: string;
		htmlUrl?: string;
		status: 'active' | 'suspended' | 'deleted';
		connectedAt: number;
		lastSyncedAt: number;
		suspendedAt?: number;
	}>
) => {
	const activeInstallations = installations
		.filter((installation) => installation.status !== 'deleted')
		.map((installation) => ({
			installationId: installation.installationId,
			accountLogin: installation.accountLogin,
			accountType: installation.accountType,
			targetType: installation.targetType,
			repositorySelection: installation.repositorySelection,
			repositoryIds: installation.repositoryIds,
			repositoryNames: installation.repositoryNames,
			contentsPermission: installation.contentsPermission,
			metadataPermission: installation.metadataPermission,
			htmlUrl: installation.htmlUrl,
			status: installation.status,
			connectedAt: installation.connectedAt,
			lastSyncedAt: installation.lastSyncedAt,
			suspendedAt: installation.suspendedAt
		}))
		.sort((a, b) => a.accountLogin.localeCompare(b.accountLogin));

	return {
		status: activeInstallations.length > 0 ? ('connected' as const) : ('disconnected' as const),
		installations: activeInstallations,
		connectedAt:
			activeInstallations.length > 0
				? Math.min(...activeInstallations.map((installation) => installation.connectedAt))
				: undefined,
		lastSyncedAt:
			activeInstallations.length > 0
				? Math.max(...activeInstallations.map((installation) => installation.lastSyncedAt))
				: undefined
	};
};

export const getMyConnection = query({
	args: {},
	returns: githubConnectionSummaryValidator,
	handler: async (ctx) => {
		const instance = await unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));
		const installations = await ctx.db
			.query('githubInstallations')
			.withIndex('by_instance', (q) => q.eq('instanceId', instance._id))
			.collect();
		return toSummary(installations);
	}
});

export const getByInstanceId = internalQuery({
	args: { instanceId: v.id('instances') },
	returns: v.array(githubInstallationValidator),
	handler: async (ctx, args) => {
		return await ctx.db
			.query('githubInstallations')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.instanceId))
			.collect();
	}
});

export const getByOwner = internalQuery({
	args: { instanceId: v.id('instances'), accountLogin: v.string() },
	returns: v.array(githubInstallationValidator),
	handler: async (ctx, args) => {
		const accountLogin = args.accountLogin.toLowerCase();
		const installations = await ctx.db
			.query('githubInstallations')
			.withIndex('by_instance_and_account_login', (q) =>
				q.eq('instanceId', args.instanceId).eq('accountLogin', accountLogin)
			)
			.collect();
		return installations.sort((a, b) => b.lastSyncedAt - a.lastSyncedAt);
	}
});

export const getByInstallationId = internalQuery({
	args: { installationId: v.number() },
	returns: v.array(githubInstallationValidator),
	handler: async (ctx, args) => {
		return await ctx.db
			.query('githubInstallations')
			.withIndex('by_installation_id', (q) => q.eq('installationId', args.installationId))
			.collect();
	}
});

export const upsertForInstance = internalMutation({
	args: {
		instanceId: v.id('instances'),
		clerkUserId: v.string(),
		installationId: v.number(),
		accountLogin: v.string(),
		accountType: v.union(v.literal('User'), v.literal('Organization')),
		targetType: v.union(v.literal('User'), v.literal('Organization')),
		repositorySelection: v.union(v.literal('all'), v.literal('selected')),
		repositoryIds: v.array(v.number()),
		repositoryNames: v.array(v.string()),
		contentsPermission: v.optional(v.string()),
		metadataPermission: v.optional(v.string()),
		htmlUrl: v.optional(v.string()),
		status: v.union(v.literal('active'), v.literal('suspended'), v.literal('deleted')),
		connectedAt: v.number(),
		lastSyncedAt: v.number(),
		suspendedAt: v.optional(v.number())
	},
	returns: v.id('githubInstallations'),
	handler: async (ctx, args) => {
		const normalizedAccountLogin = args.accountLogin.toLowerCase();
		const existing = await ctx.db
			.query('githubInstallations')
			.withIndex('by_instance_and_installation', (q) =>
				q.eq('instanceId', args.instanceId).eq('installationId', args.installationId)
			)
			.first();

		const patch = {
			clerkUserId: args.clerkUserId,
			installationId: args.installationId,
			accountLogin: normalizedAccountLogin,
			accountType: args.accountType,
			targetType: args.targetType,
			repositorySelection: args.repositorySelection,
			repositoryIds: args.repositoryIds,
			repositoryNames: args.repositoryNames,
			contentsPermission: args.contentsPermission,
			metadataPermission: args.metadataPermission,
			htmlUrl: args.htmlUrl,
			status: args.status,
			connectedAt: args.connectedAt,
			lastSyncedAt: args.lastSyncedAt,
			suspendedAt: args.suspendedAt
		};

		if (existing) {
			await ctx.db.patch(existing._id, patch);
			return existing._id;
		}

		return await ctx.db.insert('githubInstallations', {
			instanceId: args.instanceId,
			...patch
		});
	}
});

export const markDeletedByInstallationId = internalMutation({
	args: {
		installationId: v.number()
	},
	returns: v.null(),
	handler: async (ctx, args) => {
		const records = await ctx.db
			.query('githubInstallations')
			.withIndex('by_installation_id', (q) => q.eq('installationId', args.installationId))
			.collect();

		await Promise.all(
			records.map((record) =>
				ctx.db.patch(record._id, {
					status: 'deleted',
					lastSyncedAt: Date.now()
				})
			)
		);

		return null;
	}
});
