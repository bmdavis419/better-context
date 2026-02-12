'use node';

import { Daytona, type Sandbox } from '@daytonaio/sdk';
import { BTCA_SNAPSHOT_NAME } from 'btca-sandbox/shared';
import { v } from 'convex/values';
import { Result } from 'better-result';

import { api, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { action, internalAction, type ActionCtx } from '../_generated/server';
import { AnalyticsEvents } from '../analyticsEvents';
import { instances } from '../apiHelpers';
import {
	WebAuthError,
	WebConfigMissingError,
	WebUnhandledError,
	type WebError
} from '../../lib/result/errors';

const instanceQueries = instances.queries;
const instanceMutations = instances.mutations;
const BTCA_SERVER_PORT = 3000;
const SANDBOX_IDLE_MINUTES = 2;
const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_PROVIDER = 'opencode';
const BTCA_SERVER_SESSION = 'btca-server-session';
const BTCA_SERVER_LOG_PATH = '/tmp/btca-server.log';
const BTCA_PACKAGE_NAME = 'btca@latest';

const instanceArgs = { instanceId: v.id('instances') };

type ResourceConfig = {
	name: string;
	type: 'git';
	url: string;
	branch: string;
	searchPath?: string;
	specialNotes?: string;
};

type InstalledVersions = {
	btcaVersion?: string;
};

let daytonaInstance: Daytona | null = null;
type InstanceActionResult<T> = Result<T, WebError>;

function getDaytona(): Daytona {
	const daytonaResult = getDaytonaResult();
	if (Result.isError(daytonaResult)) {
		throw daytonaResult.error;
	}
	return daytonaResult.value;
}

function requireEnvResult(name: string): InstanceActionResult<string> {
	const value = process.env[name];
	if (!value) {
		return Result.err(
			new WebConfigMissingError({
				message: `${name} is not set in the Convex environment`,
				config: name
			})
		);
	}
	return Result.ok(value);
}

function requireEnv(name: string): string {
	const result = requireEnvResult(name);
	if (Result.isError(result)) {
		throw result.error;
	}
	return result.value;
}

function getDaytonaResult(): InstanceActionResult<Daytona> {
	if (!daytonaInstance) {
		const apiKeyResult = requireEnvResult('DAYTONA_API_KEY');
		if (Result.isError(apiKeyResult)) {
			return Result.err(apiKeyResult.error);
		}

		daytonaInstance = new Daytona({
			apiKey: apiKeyResult.value,
			apiUrl: process.env.DAYTONA_API_URL
		});
	}

	return Result.ok(daytonaInstance);
}

function generateBtcaConfig(resources: ResourceConfig[]): string {
	return JSON.stringify(
		{
			$schema: 'https://btca.dev/btca.schema.json',
			resources: resources.map((resource) => ({
				name: resource.name,
				type: resource.type,
				url: resource.url,
				branch: resource.branch,
				searchPath: resource.searchPath,
				specialNotes: resource.specialNotes
			})),
			model: DEFAULT_MODEL,
			provider: DEFAULT_PROVIDER
		},
		null,
		2
	);
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unknown error';
}

function parseVersion(output: string): string | undefined {
	const trimmed = output.trim();
	if (!trimmed) return undefined;
	const match = trimmed.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/);
	return match?.[0] ?? trimmed;
}

const truncate = (value?: string, maxLength = 2000) => {
	if (!value) return undefined;
	return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
};

const getErrorDetails = (error: unknown) => {
	if (error instanceof Error) {
		const withMeta = error as Error & { code?: string; cause?: unknown };
		return {
			message: error.message,
			name: error.name,
			stack: truncate(error.stack, 4000),
			code: typeof withMeta.code === 'string' ? withMeta.code : undefined,
			cause:
				withMeta.cause instanceof Error
					? withMeta.cause.message
					: typeof withMeta.cause === 'string'
						? withMeta.cause
						: undefined
		};
	}

	if (typeof error === 'string') {
		return { message: error };
	}

	return { message: 'Unknown error' };
};

const getErrorContext = (error: unknown) => {
	if (!error || typeof error !== 'object') return undefined;
	return 'context' in error ? (error as { context?: Record<string, unknown> }).context : undefined;
};

const attachErrorContext = (error: unknown, context: Record<string, unknown>) => {
	if (!error || typeof error !== 'object') return error;
	const target = error as { context?: Record<string, unknown> };
	const existing = target.context ?? {};
	const next = { ...context, ...existing };
	if (existing.step) {
		next.step = existing.step;
	}
	target.context = next;
	return error;
};

const throwInstanceError = (error: WebError): never => {
	throw error;
};

const unwrapInstance = <T>(result: InstanceActionResult<T>): T => {
	return Result.match(result, {
		ok: (value) => value,
		err: (error) => throwInstanceError(error)
	});
};

const withStep = async <T>(
	step: string,
	task: () => Promise<T>
): Promise<InstanceActionResult<T>> => {
	try {
		return Result.ok(await task());
	} catch (error) {
		const contextualError = attachErrorContext(error, { step });
		return Result.err(
			new WebUnhandledError({ message: getErrorMessage(contextualError), cause: contextualError })
		);
	}
};

const formatUserMessage = (operation: string, step: string | undefined, detail?: string) => {
	const actionLabel =
		operation === 'provision'
			? 'Provisioning'
			: operation === 'wake'
				? 'Starting'
				: operation === 'update'
					? 'Updating'
					: 'Instance';
	const stepLabel = step
		? {
				load_resources: 'loading resources',
				create_sandbox: 'creating the sandbox',
				get_sandbox: 'locating the sandbox',
				start_sandbox: 'starting the sandbox',
				upload_config: 'syncing configuration',
				start_btca: 'starting the btca server',
				health_check: 'waiting for btca to respond',
				get_versions: 'checking package versions',
				update_packages: 'updating packages',
				stop_sandbox: 'stopping the sandbox'
			}[step]
		: undefined;
	const base = `${actionLabel} failed${stepLabel ? ` while ${stepLabel}` : ''}.`;
	const trimmed = truncate(detail, 160);
	return `${base}${trimmed ? ` ${trimmed}` : ''} Please retry.`;
};

async function getResourceConfigs(
	ctx: ActionCtx,
	instanceId: Id<'instances'>,
	projectId?: Id<'projects'>
): Promise<ResourceConfig[]> {
	// If projectId is provided, get project-specific resources
	// Otherwise fall back to instance-level resources (for backwards compatibility)
	const resources = projectId
		? await ctx.runQuery(internal.resources.listAvailableForProject, { projectId })
		: await ctx.runQuery(internal.resources.listAvailableInternal, { instanceId });

	const merged = new Map<string, ResourceConfig>();
	for (const resource of [...resources.global, ...resources.custom]) {
		merged.set(resource.name, {
			name: resource.name,
			type: 'git',
			url: resource.url,
			branch: resource.branch,
			searchPath: resource.searchPath ?? undefined,
			specialNotes: resource.specialNotes ?? undefined
		});
	}
	return [...merged.values()];
}

async function requireInstance(
	ctx: ActionCtx,
	instanceId: Id<'instances'>
): Promise<Doc<'instances'>> {
	const result = await requireInstanceResult(ctx, instanceId);
	return unwrapInstance(result);
}

async function requireInstanceResult(
	ctx: ActionCtx,
	instanceId: Id<'instances'>
): Promise<InstanceActionResult<Doc<'instances'>>> {
	const instance = await ctx.runQuery(instances.internalQueries.getInternal, { id: instanceId });
	if (!instance) {
		return Result.err(new WebUnhandledError({ message: 'Instance not found' }));
	}
	return Result.ok(instance);
}

async function uploadBtcaConfig(sandbox: Sandbox, resources: ResourceConfig[]): Promise<void> {
	const config = generateBtcaConfig(resources);
	await sandbox.fs.uploadFile(Buffer.from(config), '/root/btca.config.jsonc');
}

async function getBtcaLogTail(sandbox: Sandbox, lines = 80) {
	try {
		const result = await sandbox.process.executeCommand(
			`tail -n ${lines} ${BTCA_SERVER_LOG_PATH} 2>/dev/null || true`
		);
		return result.result.trim();
	} catch {
		return '';
	}
}

async function waitForBtcaServer(sandbox: Sandbox, maxRetries = 15) {
	let lastStatus: string | undefined;
	let lastError: string | undefined;

	for (let i = 0; i < maxRetries; i++) {
		await new Promise((resolve) => setTimeout(resolve, 2000));

		try {
			const healthCheck = await sandbox.process.executeCommand(
				`curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:${BTCA_SERVER_PORT}/`
			);

			lastStatus = healthCheck.result.trim();
			if (lastStatus === '200') {
				return { ok: true, attempts: i + 1, lastStatus };
			}
		} catch (error) {
			lastError = getErrorDetails(error).message;
		}
	}

	return { ok: false, attempts: maxRetries, lastStatus, lastError };
}

async function startBtcaServer(sandbox: Sandbox): Promise<string> {
	try {
		await sandbox.process.createSession(BTCA_SERVER_SESSION);
	} catch {
		// Session may already exist
	}

	try {
		await sandbox.process.executeSessionCommand(BTCA_SERVER_SESSION, {
			command: `cd /root && btca serve --port ${BTCA_SERVER_PORT} > ${BTCA_SERVER_LOG_PATH} 2>&1`,
			runAsync: true
		});
	} catch (error) {
		throw attachErrorContext(error, { step: 'start_btca' });
	}

	const healthCheck = await waitForBtcaServer(sandbox);
	if (!healthCheck.ok) {
		const logTail = truncate(await getBtcaLogTail(sandbox), 2000);
		const error = new Error('btca server failed to start');
		throw attachErrorContext(error, {
			step: 'health_check',
			healthCheck,
			btcaLogTail: logTail
		});
	}

	try {
		const previewInfo = await sandbox.getPreviewLink(BTCA_SERVER_PORT);
		return previewInfo.url;
	} catch (error) {
		throw attachErrorContext(error, { step: 'start_btca' });
	}
}

async function stopSandboxIfRunning(sandbox: Sandbox): Promise<void> {
	if (sandbox.state === 'started') {
		await sandbox.stop(60);
	}
}

async function ensureSandboxStarted(sandbox: Sandbox): Promise<boolean> {
	if (sandbox.state === 'started') return true;
	try {
		await sandbox.start(60);
	} catch (error) {
		throw attachErrorContext(error, { step: 'start_sandbox', sandboxState: sandbox.state });
	}
	return false;
}

async function getInstalledVersions(sandbox: Sandbox): Promise<InstalledVersions> {
	const btcaResult = await sandbox.process.executeCommand('btca --version');

	return {
		btcaVersion: parseVersion(btcaResult.result)
	};
}

async function updatePackages(sandbox: Sandbox): Promise<void> {
	await sandbox.process.executeCommand(`bun add -g ${BTCA_PACKAGE_NAME}`);
}

async function fetchLatestVersion(packageName: string): Promise<string | undefined> {
	try {
		const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
		if (!response.ok) return undefined;
		const data = (await response.json()) as { version?: string };
		return data.version;
	} catch {
		return undefined;
	}
}

export const provision = action({
	args: instanceArgs,
	returns: v.object({ sandboxId: v.string() }),
	handler: async (ctx, args) => {
		requireEnv('OPENCODE_API_KEY');

		const instance = await requireInstance(ctx, args.instanceId);
		const provisionStartedAt = Date.now();

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.SANDBOX_PROVISIONING_STARTED,
			properties: { instanceId: args.instanceId }
		});

		await ctx.runMutation(instanceMutations.updateState, {
			instanceId: args.instanceId,
			state: 'provisioning'
		});

		let sandbox: Sandbox | null = null;
		let step = 'load_resources';
		try {
			const resources = unwrapInstance(
				await withStep(step, () => getResourceConfigs(ctx, args.instanceId))
			);
			const daytona = getDaytona();
			step = 'create_sandbox';
			const createdSandbox = unwrapInstance(
				await withStep(step, () =>
					daytona.create({
						snapshot: BTCA_SNAPSHOT_NAME,
						autoStopInterval: SANDBOX_IDLE_MINUTES,
						envVars: {
							NODE_ENV: 'production',
							OPENCODE_API_KEY: requireEnv('OPENCODE_API_KEY')
						},
						public: true
					})
				)
			);
			sandbox = createdSandbox;

			step = 'upload_config';
			unwrapInstance(await withStep(step, () => uploadBtcaConfig(createdSandbox, resources)));

			step = 'start_btca';
			unwrapInstance(await withStep(step, () => startBtcaServer(createdSandbox)));

			step = 'get_versions';
			const versions = unwrapInstance(
				await withStep(step, () => getInstalledVersions(createdSandbox))
			);
			step = 'stop_sandbox';
			unwrapInstance(await withStep(step, () => stopSandboxIfRunning(createdSandbox)));

			await ctx.runMutation(instanceMutations.setProvisioned, {
				instanceId: args.instanceId,
				sandboxId: createdSandbox.id,
				btcaVersion: versions.btcaVersion
			});
			await ctx.runMutation(instanceMutations.touchActivity, {
				instanceId: args.instanceId
			});

			// Schedule an update to ensure packages are up to date (snapshot may have older versions)
			await ctx.scheduler.runAfter(0, instances.actions.update, {
				instanceId: args.instanceId
			});

			const durationMs = Date.now() - provisionStartedAt;
			await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
				distinctId: instance.clerkId,
				event: AnalyticsEvents.SANDBOX_PROVISIONED,
				properties: {
					instanceId: args.instanceId,
					sandboxId: sandbox.id,
					durationMs,
					btcaVersion: versions.btcaVersion
				}
			});

			return { sandboxId: sandbox.id };
		} catch (error) {
			if (sandbox) {
				try {
					await sandbox.delete();
				} catch {
					// Ignore cleanup errors
				}
			}

			const errorDetails = getErrorDetails(error);
			const context = getErrorContext(error);
			const contextStep = typeof context?.step === 'string' ? context.step : step;
			const message = formatUserMessage('provision', contextStep, errorDetails.message);
			const durationMs = Date.now() - provisionStartedAt;

			console.error('Provisioning failed', {
				instanceId: args.instanceId,
				sandboxId: sandbox?.id,
				step: contextStep,
				durationMs,
				error: errorDetails,
				context
			});

			await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
				distinctId: instance.clerkId,
				event: AnalyticsEvents.SANDBOX_PROVISIONING_FAILED,
				properties: {
					instanceId: args.instanceId,
					sandboxId: sandbox?.id,
					step: contextStep,
					errorMessage: errorDetails.message,
					errorName: errorDetails.name,
					errorStack: errorDetails.stack,
					errorCode: errorDetails.code,
					context,
					durationMs
				}
			});

			await ctx.runMutation(instanceMutations.setError, {
				instanceId: args.instanceId,
				errorMessage: message
			});
			throw new WebUnhandledError({ message });
		}
	}
});

export const wake = action({
	args: {
		instanceId: v.id('instances'),
		projectId: v.optional(v.id('projects'))
	},
	returns: v.object({ serverUrl: v.string() }),
	handler: async (ctx, args) => wakeInstanceInternal(ctx, args.instanceId, args.projectId)
});

export const stop = action({
	args: instanceArgs,
	returns: v.object({ stopped: v.boolean() }),
	handler: async (ctx, args) => stopInstanceInternal(ctx, args.instanceId)
});

export const update = action({
	args: instanceArgs,
	returns: v.object({
		serverUrl: v.optional(v.string()),
		updated: v.optional(v.boolean())
	}),
	handler: async (ctx, args) => updateInstanceInternal(ctx, args.instanceId)
});

export const checkVersions = action({
	args: instanceArgs,
	returns: v.object({
		latestBtca: v.optional(v.string()),
		updateAvailable: v.boolean()
	}),
	handler: async (ctx, args) => {
		const instance = await requireInstance(ctx, args.instanceId);
		const latestBtca = await fetchLatestVersion(BTCA_PACKAGE_NAME);

		await ctx.runMutation(instanceMutations.setVersions, {
			instanceId: args.instanceId,
			latestBtcaVersion: latestBtca,
			lastVersionCheck: Date.now()
		});

		const updateAvailable = Boolean(
			latestBtca && instance.btcaVersion && latestBtca !== instance.btcaVersion
		);

		return {
			latestBtca,
			updateAvailable
		};
	}
});

export const destroy = action({
	args: instanceArgs,
	returns: v.object({ destroyed: v.boolean() }),
	handler: async (ctx, args) => {
		const instance = await requireInstance(ctx, args.instanceId);
		const sandboxId = instance.sandboxId;

		if (sandboxId) {
			const daytona = getDaytona();
			try {
				const sandbox = await daytona.get(sandboxId);
				await sandbox.delete(60);
			} catch {
				// Ignore deletion errors
			}
		}

		await ctx.runMutation(instanceMutations.setServerUrl, {
			instanceId: args.instanceId,
			serverUrl: ''
		});
		await ctx.runMutation(instanceMutations.updateState, {
			instanceId: args.instanceId,
			state: 'unprovisioned'
		});

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.SANDBOX_DESTROYED,
			properties: {
				instanceId: args.instanceId,
				sandboxId
			}
		});

		return { destroyed: true };
	}
});

async function requireAuthenticatedInstance(ctx: ActionCtx): Promise<Doc<'instances'>> {
	const result = await requireAuthenticatedInstanceResult(ctx);
	return unwrapInstance(result);
}

async function requireAuthenticatedInstanceResult(
	ctx: ActionCtx
): Promise<InstanceActionResult<Doc<'instances'>>> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		return Result.err(
			new WebAuthError({
				message: 'Unauthorized',
				code: 'UNAUTHORIZED'
			})
		);
	}

	const instance = await ctx.runQuery(instanceQueries.getByClerkId, {});
	if (!instance) {
		return Result.err(new WebUnhandledError({ message: 'Instance not found' }));
	}

	return Result.ok(instance);
}

async function createSandboxFromScratch(
	ctx: ActionCtx,
	instanceId: Id<'instances'>,
	instance: Doc<'instances'>
): Promise<{ sandbox: Sandbox; serverUrl: string }> {
	requireEnv('OPENCODE_API_KEY');

	let step = 'load_resources';
	const resources = unwrapInstance(await withStep(step, () => getResourceConfigs(ctx, instanceId)));
	const daytona = getDaytona();
	step = 'create_sandbox';
	const sandbox = unwrapInstance(
		await withStep(step, () =>
			daytona.create({
				snapshot: BTCA_SNAPSHOT_NAME,
				autoStopInterval: SANDBOX_IDLE_MINUTES,
				envVars: {
					NODE_ENV: 'production',
					OPENCODE_API_KEY: requireEnv('OPENCODE_API_KEY')
				},
				public: true
			})
		)
	);

	step = 'upload_config';
	unwrapInstance(await withStep(step, () => uploadBtcaConfig(sandbox, resources)));
	step = 'start_btca';
	const serverUrl = unwrapInstance(await withStep(step, () => startBtcaServer(sandbox)));
	step = 'get_versions';
	const versions = unwrapInstance(await withStep(step, () => getInstalledVersions(sandbox)));

	await ctx.runMutation(instanceMutations.setProvisioned, {
		instanceId,
		sandboxId: sandbox.id,
		btcaVersion: versions.btcaVersion
	});

	await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
		distinctId: instance.clerkId,
		event: AnalyticsEvents.SANDBOX_PROVISIONED,
		properties: {
			instanceId,
			sandboxId: sandbox.id,
			btcaVersion: versions.btcaVersion,
			createdDuringWake: true
		}
	});

	return { sandbox, serverUrl };
}

async function wakeInstanceInternal(
	ctx: ActionCtx,
	instanceId: Id<'instances'>,
	projectId?: Id<'projects'>
): Promise<{ serverUrl: string }> {
	const instance = await requireInstance(ctx, instanceId);
	const wakeStartedAt = Date.now();
	let step = 'load_instance';

	await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
		distinctId: instance.clerkId,
		event: AnalyticsEvents.SANDBOX_WAKE_STARTED,
		properties: {
			instanceId,
			sandboxId: instance.sandboxId ?? null
		}
	});

	await ctx.runMutation(instanceMutations.updateState, {
		instanceId,
		state: 'starting'
	});

	try {
		let serverUrl: string;
		let sandboxId: string;

		if (!instance.sandboxId) {
			step = 'create_sandbox';
			const result = await createSandboxFromScratch(ctx, instanceId, instance);
			serverUrl = result.serverUrl;
			sandboxId = result.sandbox.id;
		} else {
			// Use project-specific resources if projectId is provided
			step = 'load_resources';
			const resources = unwrapInstance(
				await withStep(step, () => getResourceConfigs(ctx, instanceId, projectId))
			);
			const daytona = getDaytona();
			step = 'get_sandbox';
			const sandbox = await daytona.get(instance.sandboxId);

			step = 'start_sandbox';
			unwrapInstance(await withStep(step, () => ensureSandboxStarted(sandbox)));
			step = 'upload_config';
			unwrapInstance(await withStep(step, () => uploadBtcaConfig(sandbox, resources)));
			step = 'start_btca';
			serverUrl = unwrapInstance(await withStep(step, () => startBtcaServer(sandbox)));
			sandboxId = instance.sandboxId;
		}

		await ctx.runMutation(instanceMutations.setServerUrl, { instanceId, serverUrl });
		await ctx.runMutation(instanceMutations.updateState, { instanceId, state: 'running' });
		await ctx.runMutation(instanceMutations.touchActivity, { instanceId });

		const durationMs = Date.now() - wakeStartedAt;
		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.SANDBOX_WOKE,
			properties: {
				instanceId,
				sandboxId,
				durationMs,
				createdNewSandbox: !instance.sandboxId
			}
		});

		return { serverUrl };
	} catch (error) {
		const errorDetails = getErrorDetails(error);
		const context = getErrorContext(error);
		const contextStep = typeof context?.step === 'string' ? context.step : step;
		const message = formatUserMessage('wake', contextStep, errorDetails.message);

		console.error('Wake failed', {
			instanceId,
			sandboxId: instance.sandboxId,
			step: contextStep,
			durationMs: Date.now() - wakeStartedAt,
			error: errorDetails,
			context
		});

		await ctx.runMutation(instanceMutations.setError, { instanceId, errorMessage: message });
		throw new WebUnhandledError({ message });
	}
}

async function stopInstanceInternal(
	ctx: ActionCtx,
	instanceId: Id<'instances'>
): Promise<{ stopped: boolean }> {
	const instance = await requireInstance(ctx, instanceId);
	if (!instance.sandboxId) {
		return { stopped: true };
	}

	await ctx.runMutation(instanceMutations.updateState, { instanceId, state: 'stopping' });

	try {
		const daytona = getDaytona();
		const sandbox = await daytona.get(instance.sandboxId);
		await stopSandboxIfRunning(sandbox);

		await ctx.runMutation(instanceMutations.setServerUrl, { instanceId, serverUrl: '' });
		await ctx.runMutation(instanceMutations.updateState, { instanceId, state: 'stopped' });
		await ctx.runMutation(instanceMutations.touchActivity, { instanceId });

		return { stopped: true };
	} catch (error) {
		const message = getErrorMessage(error);
		await ctx.runMutation(instanceMutations.setError, { instanceId, errorMessage: message });
		throw new WebUnhandledError({ message });
	}
}

async function updateInstanceInternal(
	ctx: ActionCtx,
	instanceId: Id<'instances'>
): Promise<{ serverUrl?: string; updated?: boolean }> {
	const instance = await requireInstance(ctx, instanceId);
	if (!instance.sandboxId) {
		throw new WebUnhandledError({ message: 'Instance does not have a sandbox to update' });
	}

	await ctx.runMutation(instanceMutations.updateState, { instanceId, state: 'updating' });

	try {
		const resources = await getResourceConfigs(ctx, instanceId);
		const daytona = getDaytona();
		const sandbox = await daytona.get(instance.sandboxId);
		let step = 'start_sandbox';
		const wasRunning = unwrapInstance(await withStep(step, () => ensureSandboxStarted(sandbox)));

		await updatePackages(sandbox);
		step = 'upload_config';
		unwrapInstance(await withStep(step, () => uploadBtcaConfig(sandbox, resources)));
		step = 'get_versions';
		const versions = unwrapInstance(await withStep(step, () => getInstalledVersions(sandbox)));

		await ctx.runMutation(instanceMutations.setVersions, {
			instanceId,
			btcaVersion: versions.btcaVersion,
			latestBtcaVersion: versions.btcaVersion,
			lastVersionCheck: Date.now()
		});
		await ctx.runMutation(instanceMutations.touchActivity, { instanceId });

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.SANDBOX_UPDATED,
			properties: {
				instanceId,
				sandboxId: instance.sandboxId,
				btcaVersion: versions.btcaVersion
			}
		});

		if (wasRunning) {
			await sandbox.process.executeCommand('pkill -f "btca serve" || true');
			const serverUrl = unwrapInstance(
				await withStep('start_btca', () => startBtcaServer(sandbox))
			);
			await ctx.runMutation(instanceMutations.setServerUrl, { instanceId, serverUrl });
			await ctx.runMutation(instanceMutations.updateState, { instanceId, state: 'running' });
			return { serverUrl };
		}

		await stopSandboxIfRunning(sandbox);
		await ctx.runMutation(instanceMutations.setServerUrl, { instanceId, serverUrl: '' });
		await ctx.runMutation(instanceMutations.updateState, { instanceId, state: 'stopped' });

		return { updated: true };
	} catch (error) {
		const message = getErrorMessage(error);
		await ctx.runMutation(instanceMutations.setError, { instanceId, errorMessage: message });
		throw new WebUnhandledError({ message });
	}
}

export const wakeMyInstance = action({
	args: {},
	returns: v.object({ serverUrl: v.string() }),
	handler: async (ctx): Promise<{ serverUrl: string }> => {
		const instance = await requireAuthenticatedInstance(ctx);
		return wakeInstanceInternal(ctx, instance._id);
	}
});

type EnsureInstanceResult = {
	instanceId: Id<'instances'>;
	status: 'created' | 'exists' | 'provisioning';
};

export const ensureInstanceExists = action({
	args: { clerkId: v.optional(v.string()) },
	returns: v.object({
		instanceId: v.id('instances'),
		status: v.union(v.literal('created'), v.literal('exists'), v.literal('provisioning'))
	}),
	handler: async (ctx, args): Promise<EnsureInstanceResult> => {
		let clerkId = args.clerkId;

		if (!clerkId) {
			const identity = await ctx.auth.getUserIdentity();
			if (!identity) {
				throw new WebAuthError({
					message: 'Unauthorized: No clerkId provided and user is not authenticated',
					code: 'UNAUTHORIZED'
				});
			}
			clerkId = identity.subject;
		}

		const existing = await ctx.runQuery(instanceQueries.getByClerkId, {});

		if (existing) {
			const isProvisioning =
				existing.state === 'unprovisioned' || existing.state === 'provisioning';
			return {
				instanceId: existing._id,
				status: isProvisioning ? 'provisioning' : 'exists'
			};
		}

		const instanceId = await ctx.runMutation(instanceMutations.create, { clerkId });

		await ctx.scheduler.runAfter(0, instances.actions.provision, { instanceId });

		return {
			instanceId,
			status: 'created'
		};
	}
});

export const stopMyInstance = action({
	args: {},
	returns: v.object({ stopped: v.boolean() }),
	handler: async (ctx): Promise<{ stopped: boolean }> => {
		const instance = await requireAuthenticatedInstance(ctx);
		return stopInstanceInternal(ctx, instance._id);
	}
});

export const updateMyInstance = action({
	args: {},
	returns: v.object({
		serverUrl: v.optional(v.string()),
		updated: v.optional(v.boolean())
	}),
	handler: async (ctx): Promise<{ serverUrl?: string; updated?: boolean }> => {
		const instance = await requireAuthenticatedInstance(ctx);
		return updateInstanceInternal(ctx, instance._id);
	}
});

export const resetMyInstance = action({
	args: {},
	returns: v.object({ reset: v.boolean() }),
	handler: async (ctx): Promise<{ reset: boolean }> => {
		const instance = await requireAuthenticatedInstance(ctx);
		const sandboxId = instance.sandboxId;

		await ctx.runMutation(instanceMutations.updateState, {
			instanceId: instance._id,
			state: 'provisioning'
		});

		if (sandboxId) {
			const daytona = getDaytona();
			try {
				const sandbox = await daytona.get(sandboxId);
				await sandbox.delete(60);
			} catch {
				// Ignore deletion errors - sandbox may already be gone
			}
		}

		await ctx.runMutation(instanceMutations.setServerUrl, {
			instanceId: instance._id,
			serverUrl: ''
		});

		await ctx.runMutation(instanceMutations.clearError, {
			instanceId: instance._id
		});

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.SANDBOX_RESET,
			properties: {
				instanceId: instance._id,
				previousSandboxId: sandboxId
			}
		});

		await ctx.scheduler.runAfter(0, instances.actions.provision, {
			instanceId: instance._id
		});

		return { reset: true };
	}
});

export const syncResources = internalAction({
	args: {
		instanceId: v.id('instances'),
		projectId: v.optional(v.id('projects'))
	},
	returns: v.object({ synced: v.boolean() }),
	handler: async (ctx, args): Promise<{ synced: boolean }> => {
		const instance = await requireInstance(ctx, args.instanceId);
		if (!instance.sandboxId || instance.state !== 'running' || !instance.serverUrl) {
			return { synced: false };
		}

		try {
			// Get project-specific resources if projectId is provided
			const resources = await getResourceConfigs(ctx, args.instanceId, args.projectId);
			const daytona = getDaytona();
			const sandbox = await daytona.get(instance.sandboxId);

			if (sandbox.state !== 'started') {
				return { synced: false };
			}

			// Upload the config and reload the server
			await uploadBtcaConfig(sandbox, resources);

			// Tell the btca server to reload its config
			const reloadResponse = await fetch(`${instance.serverUrl}/reload-config`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});

			if (!reloadResponse.ok) {
				console.error('Failed to reload config:', await reloadResponse.text());
				return { synced: false };
			}

			return { synced: true };
		} catch (error) {
			console.error('Failed to sync resources:', getErrorMessage(error));
			return { synced: false };
		}
	}
});

type CachedResourceInfo = {
	name: string;
	url: string;
	branch: string;
	sizeBytes?: number;
};

type SyncResult = {
	storageUsedBytes: number;
	cachedResources: CachedResourceInfo[];
};

const RESOURCES_DIR = '/root/.local/share/btca/resources';

async function getSandboxStatus(sandbox: Sandbox): Promise<SyncResult> {
	const duResult = await sandbox.process.executeCommand(
		`du -sb ${RESOURCES_DIR} 2>/dev/null || echo "0"`
	);
	const duMatch = duResult.result.trim().match(/^(\d+)/);
	const storageUsedBytes = duMatch ? parseInt(duMatch[1], 10) : 0;

	const lsResult = await sandbox.process.executeCommand(
		`ls -1 ${RESOURCES_DIR} 2>/dev/null || echo ""`
	);
	const resourceDirs = lsResult.result
		.trim()
		.split('\n')
		.filter((line) => line.length > 0);

	const cachedResources: CachedResourceInfo[] = [];

	for (const dir of resourceDirs) {
		const gitConfigPath = `${RESOURCES_DIR}/${dir}/.git/config`;
		const gitConfigResult = await sandbox.process.executeCommand(
			`cat "${gitConfigPath}" 2>/dev/null || echo ""`
		);

		let url = '';
		let branch = 'main';

		const urlMatch = gitConfigResult.result.match(/url\s*=\s*(.+)/);
		if (urlMatch) {
			url = urlMatch[1].trim();
		}

		const branchMatch = gitConfigResult.result.match(/\[branch\s+"([^"]+)"\]/);
		if (branchMatch) {
			branch = branchMatch[1];
		}

		const sizeResult = await sandbox.process.executeCommand(
			`du -sb "${RESOURCES_DIR}/${dir}" 2>/dev/null || echo "0"`
		);
		const sizeMatch = sizeResult.result.trim().match(/^(\d+)/);
		const sizeBytes = sizeMatch ? parseInt(sizeMatch[1], 10) : undefined;

		if (url) {
			cachedResources.push({
				name: dir,
				url,
				branch,
				sizeBytes
			});
		}
	}

	return { storageUsedBytes, cachedResources };
}

export const syncSandboxStatus = internalAction({
	args: instanceArgs,
	returns: v.union(
		v.object({
			storageUsedBytes: v.number(),
			cachedResources: v.array(
				v.object({
					name: v.string(),
					url: v.string(),
					branch: v.string(),
					sizeBytes: v.optional(v.number())
				})
			)
		}),
		v.null()
	),
	handler: async (ctx, args): Promise<SyncResult | null> => {
		const instance = await requireInstance(ctx, args.instanceId);
		if (!instance.sandboxId) {
			return null;
		}

		if (instance.state !== 'running') {
			return null;
		}

		try {
			const daytona = getDaytona();
			const sandbox = await daytona.get(instance.sandboxId);

			if (sandbox.state !== 'started') {
				return null;
			}

			const status = await getSandboxStatus(sandbox);

			await ctx.runMutation(instanceMutations.updateStorageUsed, {
				instanceId: args.instanceId,
				storageUsedBytes: status.storageUsedBytes
			});

			if (status.cachedResources.length > 0) {
				await ctx.runMutation(instanceMutations.upsertCachedResources, {
					instanceId: args.instanceId,
					resources: status.cachedResources
				});
			}

			return status;
		} catch (error) {
			console.error('Failed to sync sandbox status:', getErrorMessage(error));
			return null;
		}
	}
});
