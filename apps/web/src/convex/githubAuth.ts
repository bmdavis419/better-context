'use node';

import type { FunctionReference } from 'convex/server';
import { v } from 'convex/values';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action } from './_generated/server';
import { instances } from './apiHelpers';
import { getInstallationSnapshot } from './githubApp';
import { WebAuthError, WebUnhandledError } from '../lib/result/errors';

type InternalGithubConnections = {
	getByInstanceId: FunctionReference<
		'query',
		'internal',
		{ instanceId: Id<'instances'> },
		Array<{
			installationId: number;
		}>
	>;
	upsertForInstance: FunctionReference<
		'mutation',
		'internal',
		{
			instanceId: Id<'instances'>;
			clerkUserId: string;
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
		},
		Id<'githubInstallations'>
	>;
	markDeletedByInstallationId: FunctionReference<
		'mutation',
		'internal',
		{ installationId: number },
		null
	>;
};

const githubConnectionsInternal = internal as unknown as {
	githubConnections: InternalGithubConnections;
};

type GitHubConnectionSummary = {
	status: 'connected' | 'disconnected';
	installations: Array<{
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
	}>;
	connectedAt?: number;
	lastSyncedAt?: number;
};

export const syncMyConnection = action({
	args: {},
	returns: v.object({
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
	}),
	handler: async (ctx): Promise<GitHubConnectionSummary> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new WebAuthError({
				message: 'Authentication required',
				code: 'UNAUTHORIZED'
			});
		}

		const instance = await ctx.runQuery(instances.internalQueries.getByClerkIdInternal, {
			clerkId: identity.subject
		});
		if (!instance) {
			throw new WebUnhandledError({ message: 'Instance not found for authenticated user' });
		}

		const installations = await ctx.runQuery(
			githubConnectionsInternal.githubConnections.getByInstanceId,
			{
				instanceId: instance._id
			}
		);

		for (const installation of installations) {
			const snapshot = await getInstallationSnapshot(installation.installationId);
			if (!snapshot) {
				await ctx.runMutation(
					githubConnectionsInternal.githubConnections.markDeletedByInstallationId,
					{
						installationId: installation.installationId
					}
				);
				continue;
			}

			await ctx.runMutation(githubConnectionsInternal.githubConnections.upsertForInstance, {
				instanceId: instance._id,
				clerkUserId: identity.subject,
				installationId: snapshot.installationId,
				accountLogin: snapshot.accountLogin,
				accountType: snapshot.accountType,
				targetType: snapshot.targetType,
				repositorySelection: snapshot.repositorySelection,
				repositoryIds: snapshot.repositoryIds,
				repositoryNames: snapshot.repositoryNames,
				contentsPermission: snapshot.contentsPermission,
				metadataPermission: snapshot.metadataPermission,
				htmlUrl: snapshot.htmlUrl,
				status: snapshot.status,
				connectedAt: snapshot.connectedAt,
				lastSyncedAt: snapshot.lastSyncedAt,
				suspendedAt: snapshot.suspendedAt
			});
		}

		return await ctx.runQuery(api.githubConnections.getMyConnection, {});
	}
});
