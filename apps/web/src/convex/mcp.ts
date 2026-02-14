'use node';

import { v } from 'convex/values';
import { Result } from 'better-result';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action } from './_generated/server';
import { AnalyticsEvents } from './analyticsEvents';
import { instances } from './apiHelpers';
import type { ApiKeyValidationResult } from './clerkApiKeys';
import { toWebError, type WebError } from '../lib/result/errors';

const instanceActions = instances.actions;
const instanceMutations = instances.mutations;

type AskResult = { ok: true; text: string } | { ok: false; error: string };
type McpActionResult<T> = Result<T, WebError>;

const NPM_PACKAGE_SEGMENT_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
const NPM_VERSION_OR_TAG_REGEX = /^[^\s/]+$/;

const isValidNpmPackage = (value: string) => {
	if (!value) return false;
	if (value.startsWith('@')) {
		const parts = value.split('/');
		return (
			parts.length === 2 &&
			parts[0] !== '@' &&
			NPM_PACKAGE_SEGMENT_REGEX.test(parts[0]!.slice(1)) &&
			NPM_PACKAGE_SEGMENT_REGEX.test(parts[1]!)
		);
	}
	return !value.includes('/') && NPM_PACKAGE_SEGMENT_REGEX.test(value);
};

/**
 * Get or create a project by name for an instance.
 * If project name is not provided or is "default", returns/creates the default project.
 */
async function getOrCreateProject(
	ctx: {
		runQuery: (typeof action)['prototype']['runQuery'];
		runMutation: (typeof action)['prototype']['runMutation'];
	},
	instanceId: Id<'instances'>,
	projectName?: string
): Promise<McpActionResult<Id<'projects'>>> {
	const name = projectName || 'default';

	try {
		const existing = await ctx.runQuery(internal.projects.getByInstanceAndName, {
			instanceId,
			name
		});

		if (existing) {
			return Result.ok(existing._id);
		}

		const isDefault = name === 'default';
		const projectId = await ctx.runMutation(internal.mcpInternal.createProjectInternal, {
			instanceId,
			name,
			isDefault
		});

		return Result.ok(projectId);
	} catch (error) {
		return Result.err(toWebError(error));
	}
}

/**
 * MCP ask action - called from the SvelteKit MCP endpoint.
 * Authentication is done via API key - the caller must provide a valid API key
 * which is validated here to get the instanceId.
 *
 * @param project - Optional project name. Defaults to "default" for backward compatibility.
 */
export const ask = action({
	args: {
		apiKey: v.string(),
		question: v.string(),
		resources: v.array(v.string()),
		project: v.optional(v.string())
	},
	returns: v.union(
		v.object({ ok: v.literal(true), text: v.string() }),
		v.object({ ok: v.literal(false), error: v.string() })
	),
	handler: async (ctx, args): Promise<AskResult> => {
		const { apiKey, question, resources, project: projectName } = args;

		// Validate API key with Clerk
		const validation = (await ctx.runAction(api.clerkApiKeys.validate, {
			apiKey
		})) as ApiKeyValidationResult;
		if (!validation.valid) {
			return { ok: false as const, error: validation.error };
		}

		const { instanceId, clerkUserId } = validation;
		const effectiveProjectName = projectName || 'default';
		const baseProperties = {
			instanceId,
			project: effectiveProjectName,
			resourceCount: resources.length,
			resources,
			questionLength: question.length
		};
		const trackAskEvent = (event: string, properties: Record<string, unknown>) =>
			ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
				distinctId: clerkUserId,
				event,
				properties
			});
		const trackAskFailure = (error: string, properties: Record<string, unknown> = {}) =>
			trackAskEvent(AnalyticsEvents.MCP_ASK_FAILED, {
				...baseProperties,
				...properties,
				error
			});

		// Get instance
		const instance = await ctx.runQuery(instances.internalQueries.getInternal, { id: instanceId });
		if (!instance) {
			await trackAskFailure('Instance not found');
			return { ok: false as const, error: 'Instance not found' };
		}

		// Get or create the project
		const projectIdResult = await getOrCreateProject(ctx, instanceId, projectName);
		if (Result.isError(projectIdResult)) {
			await trackAskFailure(projectIdResult.error.message);
			return { ok: false as const, error: projectIdResult.error.message };
		}
		const projectId = projectIdResult.value;
		const projectProperties = { ...baseProperties, projectId };

		// Note: Usage tracking is handled in the validate action via touchUsage

		// Validate resources against project-specific resources
		const availableResources: {
			global: { name: string }[];
			custom: { name: string }[];
		} = await ctx.runQuery(internal.resources.listAvailableForProject, { projectId });
		const allResourceNames: string[] = [
			...availableResources.global.map((r: { name: string }) => r.name),
			...availableResources.custom.map((r: { name: string }) => r.name)
		];

		const invalidResources: string[] = resources.filter(
			(r: string) => !allResourceNames.includes(r)
		);
		if (invalidResources.length > 0) {
			await trackAskFailure('Invalid resources', { ...projectProperties, invalidResources });
			return {
				ok: false as const,
				error: `Invalid resources: ${invalidResources.join(', ')}. Use listResources to see available resources.`
			};
		}

		if (instance.state === 'error') {
			await trackAskFailure('Instance is in an error state', {
				...projectProperties,
				instanceState: instance.state
			});
			return { ok: false as const, error: 'Instance is in an error state' };
		}

		if (instance.state === 'provisioning' || instance.state === 'unprovisioned') {
			await trackAskFailure('Instance is still provisioning', {
				...projectProperties,
				instanceState: instance.state
			});
			return { ok: false as const, error: 'Instance is still provisioning' };
		}

		let serverUrl = instance.serverUrl;
		if (instance.state !== 'running' || !serverUrl) {
			if (!instance.sandboxId) {
				await trackAskFailure('Instance does not have a sandbox', projectProperties);
				return { ok: false as const, error: 'Instance does not have a sandbox' };
			}
			// Pass projectId to wake so it uses project-specific resources
			const wakeResult = await ctx.runAction(instanceActions.wake, { instanceId, projectId });
			serverUrl = wakeResult.serverUrl;
			if (!serverUrl) {
				await trackAskFailure('Failed to wake instance', projectProperties);
				return { ok: false as const, error: 'Failed to wake instance' };
			}
		} else {
			// Sandbox is already running - sync project-specific resources and reload config
			await ctx.runAction(internal.instances.actions.syncResources, { instanceId, projectId });
		}

		const startedAt = Date.now();
		const response = await fetch(`${serverUrl}/question`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				question,
				resources,
				project: effectiveProjectName,
				quiet: true
			})
		});

		if (!response.ok) {
			const errorText = await response.text();
			await trackAskFailure(errorText || `Server error: ${response.status}`, {
				...projectProperties,
				status: response.status,
				durationMs: Date.now() - startedAt
			});
			return { ok: false as const, error: errorText || `Server error: ${response.status}` };
		}

		const result = (await response.json()) as { answer?: string; text?: string };
		const answerText = result.answer ?? result.text ?? JSON.stringify(result);

		// Record the question/answer for the project
		await ctx.runMutation(internal.mcpInternal.recordQuestion, {
			projectId,
			question,
			resources,
			answer: answerText
		});

		await ctx.runMutation(instanceMutations.touchActivity, { instanceId });

		await trackAskEvent(AnalyticsEvents.MCP_ASK, {
			...projectProperties,
			durationMs: Date.now() - startedAt
		});

		return {
			ok: true as const,
			text: answerText
		};
	}
});

type ListResourcesResult =
	| { ok: false; error: string }
	| {
			ok: true;
			resources: Array<
				| {
						name: string;
						displayName: string;
						type: 'git';
						url: string;
						branch: string;
						searchPath?: string;
						specialNotes?: string;
						isGlobal: false;
				  }
				| {
						name: string;
						displayName: string;
						type: 'npm';
						package: string;
						version?: string;
						specialNotes?: string;
						isGlobal: false;
				  }
			>;
	  };

/**
 * List available resources for MCP - authenticated via API key
 *
 * @param project - Optional project name. Defaults to "default" for backward compatibility.
 *                  Returns resources specific to the given project.
 */
export const listResources = action({
	args: {
		apiKey: v.string(),
		project: v.optional(v.string())
	},
	returns: v.union(
		v.object({ ok: v.literal(false), error: v.string() }),
		v.object({
			ok: v.literal(true),
			resources: v.array(
				v.union(
					v.object({
						name: v.string(),
						displayName: v.string(),
						type: v.literal('git'),
						url: v.string(),
						branch: v.string(),
						searchPath: v.optional(v.string()),
						specialNotes: v.optional(v.string()),
						isGlobal: v.literal(false)
					}),
					v.object({
						name: v.string(),
						displayName: v.string(),
						type: v.literal('npm'),
						package: v.string(),
						version: v.optional(v.string()),
						specialNotes: v.optional(v.string()),
						isGlobal: v.literal(false)
					})
				)
			)
		})
	),
	handler: async (ctx, args): Promise<ListResourcesResult> => {
		const { apiKey, project: projectName } = args;

		// Validate API key with Clerk
		const validation = (await ctx.runAction(api.clerkApiKeys.validate, {
			apiKey
		})) as ApiKeyValidationResult;
		if (!validation.valid) {
			return { ok: false as const, error: validation.error };
		}

		const instanceId = validation.instanceId;

		// Get or create the project
		const projectIdResult = await getOrCreateProject(ctx, instanceId, projectName);
		if (Result.isError(projectIdResult)) {
			return { ok: false as const, error: projectIdResult.error.message };
		}

		const projectId = projectIdResult.value;

		// Return project-specific resources
		const { custom } = await ctx.runQuery(internal.resources.listAvailableForProject, {
			projectId
		});

		return { ok: true as const, resources: custom };
	}
});

type AddResourceResult =
	| { ok: false; error: string }
	| {
			ok: true;
			resource:
				| {
						name: string;
						displayName: string;
						type: 'git';
						url: string;
						branch: string;
						searchPath?: string;
						specialNotes?: string;
				  }
				| {
						name: string;
						displayName: string;
						type: 'npm';
						package: string;
						version?: string;
						specialNotes?: string;
				  };
	  };

/**
 * Add a resource via MCP - authenticated via API key
 */
export const addResource = action({
	args: {
		apiKey: v.string(),
		type: v.optional(v.union(v.literal('git'), v.literal('npm'))),
		name: v.string(),
		url: v.optional(v.string()),
		branch: v.optional(v.string()),
		searchPath: v.optional(v.string()),
		searchPaths: v.optional(v.array(v.string())),
		package: v.optional(v.string()),
		version: v.optional(v.string()),
		notes: v.optional(v.string()),
		project: v.optional(v.string())
	},
	returns: v.union(
		v.object({ ok: v.literal(false), error: v.string() }),
		v.object({
			ok: v.literal(true),
			resource: v.union(
				v.object({
					name: v.string(),
					displayName: v.string(),
					type: v.literal('git'),
					url: v.string(),
					branch: v.string(),
					searchPath: v.optional(v.string()),
					specialNotes: v.optional(v.string())
				}),
				v.object({
					name: v.string(),
					displayName: v.string(),
					type: v.literal('npm'),
					package: v.string(),
					version: v.optional(v.string()),
					specialNotes: v.optional(v.string())
				})
			)
		})
	),
	handler: async (ctx, args): Promise<AddResourceResult> => {
		const {
			apiKey,
			type,
			url,
			name,
			branch,
			searchPath,
			searchPaths,
			package: packageName,
			version,
			notes,
			project: projectName
		} = args;

		// Validate API key with Clerk
		const validation = (await ctx.runAction(api.clerkApiKeys.validate, {
			apiKey
		})) as ApiKeyValidationResult;
		if (!validation.valid) {
			return { ok: false as const, error: validation.error };
		}

		const instanceId = validation.instanceId;

		// Get or create the project
		const projectIdResult = await getOrCreateProject(ctx, instanceId, projectName);
		if (Result.isError(projectIdResult)) {
			return { ok: false as const, error: projectIdResult.error.message };
		}

		const projectId = projectIdResult.value;

		// Note: Usage tracking is handled in the validate action via touchUsage

		const hasGitFields =
			typeof url === 'string' ||
			typeof branch === 'string' ||
			typeof searchPath === 'string' ||
			typeof searchPaths !== 'undefined';
		const hasNpmFields = typeof packageName === 'string' || typeof version === 'string';

		if (!type && hasGitFields && hasNpmFields) {
			return {
				ok: false as const,
				error:
					'Ambiguous resource payload. Set type to "git" or "npm" when sending both git and npm fields.'
			};
		}
		const resolvedType = type ?? (hasNpmFields ? 'npm' : 'git');

		// Check if resource with this name already exists in this project
		const exists = await ctx.runQuery(internal.resources.resourceExistsInProject, {
			projectId,
			name
		});
		if (exists) {
			return { ok: false as const, error: `Resource "${name}" already exists in this project` };
		}

		if (resolvedType === 'git') {
			if (hasNpmFields) {
				return {
					ok: false as const,
					error: 'Git resources cannot include npm package/version fields'
				};
			}
			if (!url?.trim()) {
				return { ok: false as const, error: 'Git URL is required' };
			}
			if (!url.startsWith('https://')) {
				return { ok: false as const, error: 'URL must be an HTTPS URL' };
			}
			const finalSearchPath = searchPath ?? searchPaths?.[0];
			const resolvedBranch = branch?.trim() || 'main';
			await ctx.runMutation(internal.mcpInternal.addResourceInternal, {
				instanceId,
				projectId,
				name,
				type: 'git',
				url,
				branch: resolvedBranch,
				searchPath: finalSearchPath,
				specialNotes: notes
			});

			return {
				ok: true as const,
				resource: {
					name,
					displayName: name,
					type: 'git',
					url,
					branch: resolvedBranch,
					searchPath: finalSearchPath,
					specialNotes: notes
				}
			};
		}

		if (hasGitFields) {
			return {
				ok: false as const,
				error: 'npm resources cannot include git URL/branch/searchPath fields'
			};
		}
		if (!packageName?.trim()) {
			return { ok: false as const, error: 'npm package is required' };
		}
		if (!isValidNpmPackage(packageName.trim())) {
			return {
				ok: false as const,
				error: 'npm package must be a valid package name (for example react or @types/node)'
			};
		}
		if (version && !NPM_VERSION_OR_TAG_REGEX.test(version)) {
			return { ok: false as const, error: 'npm version/tag must not contain spaces or "/"' };
		}
		const resolvedVersion = version?.trim() || undefined;
		await ctx.runMutation(internal.mcpInternal.addResourceInternal, {
			instanceId,
			projectId,
			name,
			type: 'npm',
			package: packageName.trim(),
			version: resolvedVersion,
			specialNotes: notes
		});

		return {
			ok: true as const,
			resource: {
				name,
				displayName: name,
				type: 'npm',
				package: packageName.trim(),
				version: resolvedVersion,
				specialNotes: notes
			}
		};
	}
});
