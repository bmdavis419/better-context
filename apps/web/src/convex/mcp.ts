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

function stripJsonComments(content: string): string {
	let result = '';
	let inString = false;
	let inLineComment = false;
	let inBlockComment = false;
	let i = 0;

	while (i < content.length) {
		const char = content[i];
		const next = content[i + 1];

		if (inLineComment) {
			if (char === '\n') {
				inLineComment = false;
				result += char;
			}
			i++;
			continue;
		}

		if (inBlockComment) {
			if (char === '*' && next === '/') {
				inBlockComment = false;
				i += 2;
				continue;
			}
			i++;
			continue;
		}

		if (inString) {
			result += char;
			if (char === '\\' && i + 1 < content.length) {
				result += content[i + 1];
				i += 2;
				continue;
			}
			if (char === '"') {
				inString = false;
			}
			i++;
			continue;
		}

		if (char === '"') {
			inString = true;
			result += char;
			i++;
			continue;
		}

		if (char === '/' && next === '/') {
			inLineComment = true;
			i += 2;
			continue;
		}

		if (char === '/' && next === '*') {
			inBlockComment = true;
			i += 2;
			continue;
		}

		result += char;
		i++;
	}

	return result.replace(/,(\s*[}\]])/g, '$1');
}

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
			resources: {
				name: string;
				displayName: string;
				type: string;
				url: string;
				branch: string;
				searchPath: string | undefined;
				specialNotes: string | undefined;
				isGlobal: false;
			}[];
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
				v.object({
					name: v.string(),
					displayName: v.string(),
					type: v.string(),
					url: v.string(),
					branch: v.string(),
					searchPath: v.optional(v.string()),
					specialNotes: v.optional(v.string()),
					isGlobal: v.literal(false)
				})
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
			resource: {
				name: string;
				displayName: string;
				type: string;
				url: string;
				branch: string;
				searchPath: string | undefined;
				specialNotes: string | undefined;
			};
	  };

/**
 * Add a resource via MCP - authenticated via API key
 */
export const addResource = action({
	args: {
		apiKey: v.string(),
		url: v.string(),
		name: v.string(),
		branch: v.string(),
		searchPath: v.optional(v.string()),
		searchPaths: v.optional(v.array(v.string())),
		notes: v.optional(v.string()),
		project: v.optional(v.string())
	},
	returns: v.union(
		v.object({ ok: v.literal(false), error: v.string() }),
		v.object({
			ok: v.literal(true),
			resource: v.object({
				name: v.string(),
				displayName: v.string(),
				type: v.string(),
				url: v.string(),
				branch: v.string(),
				searchPath: v.optional(v.string()),
				specialNotes: v.optional(v.string())
			})
		})
	),
	handler: async (ctx, args): Promise<AddResourceResult> => {
		const {
			apiKey,
			url,
			name,
			branch,
			searchPath,
			searchPaths,
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

		// Validate URL (basic check)
		if (!url.startsWith('https://')) {
			return { ok: false as const, error: 'URL must be an HTTPS URL' };
		}

		// Check if resource with this name already exists in this project
		const exists = await ctx.runQuery(internal.resources.resourceExistsInProject, {
			projectId,
			name
		});
		if (exists) {
			return { ok: false as const, error: `Resource "${name}" already exists in this project` };
		}

		// Add the resource
		const finalSearchPath = searchPath ?? searchPaths?.[0];
		await ctx.runMutation(internal.mcpInternal.addResourceInternal, {
			instanceId,
			projectId,
			name,
			url,
			branch,
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
				branch,
				searchPath: finalSearchPath,
				specialNotes: notes
			}
		};
	}
});

type SyncResult = {
	ok: boolean;
	errors?: string[];
	synced: string[];
	conflicts?: Array<{
		name: string;
		local: { url: string; branch: string };
		remote: { url: string; branch: string };
	}>;
};

/**
 * Sync remote config with cloud - authenticated via API key
 */
export const sync = action({
	args: {
		apiKey: v.string(),
		config: v.string(),
		force: v.boolean()
	},
	returns: v.object({
		ok: v.boolean(),
		errors: v.optional(v.array(v.string())),
		synced: v.array(v.string()),
		conflicts: v.optional(
			v.array(
				v.object({
					name: v.string(),
					local: v.object({ url: v.string(), branch: v.string() }),
					remote: v.object({ url: v.string(), branch: v.string() })
				})
			)
		)
	}),
	handler: async (ctx, args): Promise<SyncResult> => {
		const { apiKey, config: configStr, force } = args;

		// Validate API key with Clerk
		const validation = (await ctx.runAction(api.clerkApiKeys.validate, {
			apiKey
		})) as ApiKeyValidationResult;
		if (!validation.valid) {
			return { ok: false, errors: [validation.error], synced: [] };
		}

		const instanceId = validation.instanceId;

		// Note: Usage tracking is handled in the validate action via touchUsage

		// Parse the config
		let config: {
			project: string;
			model?: string;
			resources: Array<{
				type?: string;
				name: string;
				url: string;
				branch: string;
				searchPath?: string;
				searchPaths?: string[];
				specialNotes?: string;
			}>;
		};

		try {
			const stripped = stripJsonComments(configStr);
			config = JSON.parse(stripped);
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : 'Unknown parse error';
			return {
				ok: false,
				errors: [`Invalid JSON in config: ${errorMsg}`],
				synced: []
			};
		}

		if (!config.project || typeof config.project !== 'string') {
			return {
				ok: false,
				errors: ['Missing or invalid "project" field in config (must be a string)'],
				synced: []
			};
		}

		if (!Array.isArray(config.resources)) {
			return {
				ok: false,
				errors: ['Missing or invalid "resources" field in config (must be an array)'],
				synced: []
			};
		}

		const resourceErrors: string[] = [];
		for (let i = 0; i < config.resources.length; i++) {
			const r = config.resources[i];
			if (!r || typeof r !== 'object') {
				resourceErrors.push(`resources[${i}]: must be an object`);
				continue;
			}
			if (!r.name || typeof r.name !== 'string') {
				resourceErrors.push(`resources[${i}]: missing or invalid "name" (must be a string)`);
			}
			if (!r.url || typeof r.url !== 'string') {
				resourceErrors.push(`resources[${i}]: missing or invalid "url" (must be a string)`);
			}
			if (!r.branch || typeof r.branch !== 'string') {
				resourceErrors.push(`resources[${i}]: missing or invalid "branch" (must be a string)`);
			}
		}

		if (resourceErrors.length > 0) {
			return { ok: false, errors: resourceErrors, synced: [] };
		}

		// Get or create the project
		const projectIdResult = await getOrCreateProject(ctx, instanceId, config.project);
		if (Result.isError(projectIdResult)) {
			return { ok: false, errors: [projectIdResult.error.message], synced: [] };
		}
		const projectId = projectIdResult.value;

		// Get current resources for this project
		const existingResources = await ctx.runQuery(internal.resources.listByProject, {
			projectId
		});

		const synced: string[] = [];
		const errors: string[] = [];
		const conflicts: SyncResult['conflicts'] = [];

		// Process each resource in the config
		for (const localResource of config.resources) {
			const existingResource = existingResources.find(
				(r: { name: string; url: string; branch: string }) =>
					r.name.toLowerCase() === localResource.name.toLowerCase()
			);

			if (existingResource) {
				// Check for conflicts
				const urlMatch = existingResource.url === localResource.url;
				const branchMatch = existingResource.branch === localResource.branch;

				if (!urlMatch || !branchMatch) {
					if (force) {
						// Update the resource
						await ctx.runMutation(internal.mcpInternal.updateResourceInternal, {
							instanceId,
							projectId,
							name: localResource.name,
							url: localResource.url,
							branch: localResource.branch,
							searchPath: localResource.searchPath ?? localResource.searchPaths?.[0],
							specialNotes: localResource.specialNotes
						});
						synced.push(localResource.name);
					} else {
						conflicts.push({
							name: localResource.name,
							local: { url: localResource.url, branch: localResource.branch },
							remote: { url: existingResource.url, branch: existingResource.branch }
						});
					}
				}
				// If they match, nothing to do
			} else {
				// Add new resource
				try {
					await ctx.runMutation(internal.mcpInternal.addResourceInternal, {
						instanceId,
						projectId,
						name: localResource.name,
						url: localResource.url,
						branch: localResource.branch,
						searchPath: localResource.searchPath ?? localResource.searchPaths?.[0],
						specialNotes: localResource.specialNotes
					});
					synced.push(localResource.name);
				} catch (err) {
					errors.push(
						`Failed to add "${localResource.name}": ${err instanceof Error ? err.message : String(err)}`
					);
				}
			}
		}

		// Update project model if specified
		if (config.model) {
			await ctx.runMutation(internal.mcpInternal.updateProjectModelInternal, {
				projectId,
				model: config.model
			});
		}

		if (conflicts.length > 0) {
			return { ok: false, errors, synced, conflicts };
		}

		return { ok: errors.length === 0, errors: errors.length > 0 ? errors : undefined, synced };
	}
});
