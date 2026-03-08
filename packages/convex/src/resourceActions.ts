'use node';

import { getResourceNameError } from '@btca/shared';
import type { FunctionReference } from 'convex/server';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, type ActionCtx } from './_generated/server';
import { AnalyticsEvents } from './analyticsEvents';
import { instances } from './apiHelpers';
import {
	ensureGitHubBranch,
	fetchGitHubRepo,
	getRepoFullName,
	parseGitHubRepoRef,
	resolveAccessibleRepo
} from './githubApp';
import { WebAuthError, WebUnhandledError, WebValidationError } from './lib/result/errors';

type InternalResources = {
	addCustomResourceInternal: FunctionReference<
		'mutation',
		'internal',
		{
			instanceId: Id<'instances'>;
			projectId?: Id<'projects'>;
			name: string;
			type: 'git' | 'npm';
			url?: string;
			branch?: string;
			package?: string;
			version?: string;
			searchPath?: string;
			specialNotes?: string;
			gitProvider?: 'github' | 'generic';
			visibility?: 'public' | 'private';
			authSource?: 'clerk_github_oauth' | 'github_app';
		},
		Id<'userResources'>
	>;
	resourceExistsInProject: FunctionReference<
		'query',
		'internal',
		{ projectId: Id<'projects'>; name: string },
		boolean
	>;
};

type InternalAnalytics = {
	trackEvent: FunctionReference<
		'action',
		'internal',
		{ distinctId: string; event: string; properties: Record<string, unknown> },
		void
	>;
};

type GitHubInstallationRecord = {
	installationId: number;
	accountLogin: string;
	repositorySelection: 'all' | 'selected';
	repositoryNames: string[];
	status: 'active' | 'suspended' | 'deleted';
};

const resourcesInternal = internal as unknown as {
	resources: InternalResources;
	githubConnections: {
		getByOwner: FunctionReference<
			'query',
			'internal',
			{
				instanceId: Id<'instances'>;
				accountLogin: string;
			},
			GitHubInstallationRecord[]
		>;
	};
	analytics: InternalAnalytics;
};

type GitHubRepoResponse = {
	private: boolean;
	default_branch: string;
};

const NPM_PACKAGE_SEGMENT_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
const NPM_VERSION_OR_TAG_REGEX = /^[^\s/]+$/;

const isValidNpmPackageName = (name: string) => {
	if (name.startsWith('@')) {
		const parts = name.split('/');
		return (
			parts.length === 2 &&
			parts[0] !== '@' &&
			NPM_PACKAGE_SEGMENT_REGEX.test(parts[0]!.slice(1)) &&
			NPM_PACKAGE_SEGMENT_REGEX.test(parts[1]!)
		);
	}

	return !name.includes('/') && NPM_PACKAGE_SEGMENT_REGEX.test(name);
};

const getOwnerInstallations = async (ctx: ActionCtx, instanceId: Id<'instances'>, owner: string) =>
	await ctx.runQuery(resourcesInternal.githubConnections.getByOwner, {
		instanceId,
		accountLogin: owner.toLowerCase()
	});

const resolveGitMetadata = async (
	ctx: ActionCtx,
	instanceId: Id<'instances'>,
	url: string,
	branch: string
) => {
	const repoRef = parseGitHubRepoRef(url);
	if (!repoRef) {
		return {
			branch,
			gitProvider: 'generic' as const,
			visibility: 'public' as const
		};
	}

	const publicResponse = await fetchGitHubRepo(repoRef);
	if (publicResponse.ok) {
		const repo = (await publicResponse.json()) as GitHubRepoResponse;
		const resolvedBranch = branch.trim() || repo.default_branch;
		await ensureGitHubBranch(repoRef, resolvedBranch);
		return {
			branch: resolvedBranch,
			gitProvider: 'github' as const,
			visibility: repo.private ? ('private' as const) : ('public' as const),
			authSource: repo.private ? ('github_app' as const) : undefined
		};
	}

	if (publicResponse.status !== 403 && publicResponse.status !== 404) {
		throw new WebUnhandledError({
			message: `GitHub repository lookup failed with status ${publicResponse.status}`
		});
	}

	const repoFullName = getRepoFullName(repoRef);
	const activeInstallations = (await getOwnerInstallations(ctx, instanceId, repoRef.owner)).filter(
		(installation) => installation.status === 'active'
	);

	if (activeInstallations.length === 0) {
		throw new WebAuthError({
			message: `Connect GitHub and install the btca GitHub App on ${repoRef.owner} before adding private repositories.`,
			code: 'UNAUTHORIZED'
		});
	}

	for (const installation of activeInstallations) {
		if (
			installation.repositorySelection === 'selected' &&
			installation.repositoryNames.length > 0 &&
			!installation.repositoryNames.includes(repoFullName)
		) {
			continue;
		}

		const accessibleRepo = await resolveAccessibleRepo(installation.installationId, repoRef);
		if (!accessibleRepo) {
			continue;
		}

		const resolvedBranch = branch.trim() || accessibleRepo.repo.default_branch;
		await ensureGitHubBranch(repoRef, resolvedBranch, accessibleRepo.token);

		return {
			branch: resolvedBranch,
			gitProvider: 'github' as const,
			visibility: accessibleRepo.repo.private ? ('private' as const) : ('public' as const),
			authSource: accessibleRepo.repo.private ? ('github_app' as const) : undefined
		};
	}

	throw new WebAuthError({
		message: `Grant the ${repoFullName} repository to the btca GitHub App before adding it.`,
		code: 'FORBIDDEN'
	});
};

export const addCustomResource = action({
	args: {
		name: v.string(),
		type: v.union(v.literal('git'), v.literal('npm')),
		url: v.optional(v.string()),
		branch: v.optional(v.string()),
		package: v.optional(v.string()),
		version: v.optional(v.string()),
		searchPath: v.optional(v.string()),
		specialNotes: v.optional(v.string()),
		projectId: v.optional(v.id('projects'))
	},
	returns: v.id('userResources'),
	handler: async (ctx, args) => {
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

		const nameError = getResourceNameError(args.name);
		if (nameError) {
			throw new WebValidationError({ message: nameError, field: 'name' });
		}

		if (args.projectId) {
			const project = await ctx.runQuery(internal.projects.getInternal, {
				projectId: args.projectId
			});
			if (!project || project.instanceId !== instance._id) {
				throw new WebValidationError({ message: 'Project not found', field: 'projectId' });
			}

			const exists = await ctx.runQuery(resourcesInternal.resources.resourceExistsInProject, {
				projectId: args.projectId,
				name: args.name
			});
			if (exists) {
				throw new WebValidationError({
					message: `Resource "${args.name}" already exists in this project`,
					field: 'name'
				});
			}
		}

		if (args.type === 'npm') {
			const packageName = args.package?.trim();
			const version = args.version?.trim() || undefined;

			if (!packageName) {
				throw new WebValidationError({
					message: 'npm package is required',
					field: 'package'
				});
			}

			if (!isValidNpmPackageName(packageName)) {
				throw new WebValidationError({
					message:
						'npm package must be a valid npm package name (for example react or @types/node)',
					field: 'package'
				});
			}

			if (version && !NPM_VERSION_OR_TAG_REGEX.test(version)) {
				throw new WebValidationError({
					message: 'Version/tag must not contain spaces or "/"',
					field: 'version'
				});
			}

			const resourceId = await ctx.runMutation(
				resourcesInternal.resources.addCustomResourceInternal,
				{
					instanceId: instance._id,
					projectId: args.projectId,
					name: args.name,
					type: 'npm',
					package: packageName,
					version,
					specialNotes: args.specialNotes
				}
			);

			await ctx.scheduler.runAfter(0, instances.internalActions.syncResources, {
				instanceId: instance._id,
				projectId: args.projectId
			});

			await ctx.scheduler.runAfter(0, resourcesInternal.analytics.trackEvent, {
				distinctId: instance.clerkId,
				event: AnalyticsEvents.RESOURCE_ADDED,
				properties: {
					instanceId: instance._id,
					resourceId,
					resourceName: args.name,
					resourceType: 'npm',
					packageName,
					version,
					hasNotes: !!args.specialNotes
				}
			});

			return resourceId;
		}

		if (!args.url?.trim()) {
			throw new WebValidationError({
				message: 'Git URL is required',
				field: 'url'
			});
		}

		try {
			new URL(args.url);
		} catch {
			throw new WebValidationError({
				message: 'Invalid URL format',
				field: 'url'
			});
		}

		const metadata = await resolveGitMetadata(ctx, instance._id, args.url, args.branch ?? 'main');
		const resourceId = await ctx.runMutation(
			resourcesInternal.resources.addCustomResourceInternal,
			{
				instanceId: instance._id,
				projectId: args.projectId,
				name: args.name,
				type: 'git',
				url: args.url,
				branch: metadata.branch,
				searchPath: args.searchPath,
				specialNotes: args.specialNotes,
				gitProvider: metadata.gitProvider,
				visibility: metadata.visibility,
				authSource: metadata.authSource
			}
		);

		await ctx.scheduler.runAfter(0, instances.internalActions.syncResources, {
			instanceId: instance._id,
			projectId: args.projectId
		});

		await ctx.scheduler.runAfter(0, resourcesInternal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.RESOURCE_ADDED,
			properties: {
				instanceId: instance._id,
				resourceId,
				resourceName: args.name,
				resourceUrl: args.url,
				resourceVisibility: metadata.visibility,
				hasBranch: metadata.branch !== 'main',
				hasSearchPath: !!args.searchPath,
				hasNotes: !!args.specialNotes
			}
		});

		return resourceId;
	}
});
