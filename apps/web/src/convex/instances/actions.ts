'use node';

import { Daytona, type Sandbox } from '@daytonaio/sdk';
import { BTCA_SNAPSHOT_NAME } from 'btca-sandbox/shared';
import { v } from 'convex/values';

import { api, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { action, internalAction, type ActionCtx } from '../_generated/server';
import { AnalyticsEvents } from '../analyticsEvents';
import { instances } from '../apiHelpers';

const instanceQueries = instances.queries;
const instanceMutations = instances.mutations;
const BTCA_SERVER_PORT = 3000;
const SANDBOX_IDLE_MINUTES = 2;
const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_PROVIDER = 'opencode';
const BTCA_SERVER_SESSION = 'btca-server-session';
const BTCA_PACKAGE_NAME = 'btca@latest';
const OPENCODE_PACKAGE_NAME = 'opencode-ai@latest';

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
	opencodeVersion?: string;
};

let daytonaInstance: Daytona | null = null;

function getDaytona(): Daytona {
	if (!daytonaInstance) {
		const apiKey = requireEnv('DAYTONA_API_KEY');
		daytonaInstance = new Daytona({
			apiKey,
			apiUrl: process.env.DAYTONA_API_URL
		});
	}
	return daytonaInstance;
}

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is not set in the Convex environment`);
	}
	return value;
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

async function waitForBtcaServer(sandbox: Sandbox, maxRetries = 15): Promise<boolean> {
	for (let i = 0; i < maxRetries; i++) {
		await new Promise((resolve) => setTimeout(resolve, 2000));

		try {
			const healthCheck = await sandbox.process.executeCommand(
				`curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:${BTCA_SERVER_PORT}/`
			);

			const statusCode = healthCheck.result.trim();
			if (statusCode === '200') {
				return true;
			}
		} catch {
			// Continue retrying
		}
	}
	return false;
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

async function getResourceConfigs(
	ctx: ActionCtx,
	instanceId: Id<'instances'>
): Promise<ResourceConfig[]> {
	const resources = await ctx.runQuery(api.resources.listAvailableInternal, {
		instanceId
	});
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
	const instance = await ctx.runQuery(instances.internalQueries.getInternal, { id: instanceId });
	if (!instance) {
		throw new Error('Instance not found');
	}
	return instance;
}

async function uploadBtcaConfig(sandbox: Sandbox, resources: ResourceConfig[]): Promise<void> {
	const config = generateBtcaConfig(resources);
	await sandbox.fs.uploadFile(Buffer.from(config), '/root/btca.config.jsonc');
}

async function startBtcaServer(sandbox: Sandbox): Promise<string> {
	try {
		await sandbox.process.createSession(BTCA_SERVER_SESSION);
	} catch {
		// Session may already exist
	}

	await sandbox.process.executeSessionCommand(BTCA_SERVER_SESSION, {
		command: `cd /root && btca serve --port ${BTCA_SERVER_PORT}`,
		runAsync: true
	});

	const serverReady = await waitForBtcaServer(sandbox);
	if (!serverReady) {
		throw new Error('btca server failed to start');
	}

	const previewInfo = await sandbox.getPreviewLink(BTCA_SERVER_PORT);
	return previewInfo.url;
}

async function stopSandboxIfRunning(sandbox: Sandbox): Promise<void> {
	if (sandbox.state === 'started') {
		await sandbox.stop(60);
	}
}

async function ensureSandboxStarted(sandbox: Sandbox): Promise<boolean> {
	if (sandbox.state === 'started') return true;
	await sandbox.start(60);
	return false;
}

async function getInstalledVersions(sandbox: Sandbox): Promise<InstalledVersions> {
	const [btcaResult, opencodeResult] = await Promise.all([
		sandbox.process.executeCommand('btca --version'),
		sandbox.process.executeCommand('opencode --version')
	]);

	return {
		btcaVersion: parseVersion(btcaResult.result),
		opencodeVersion: parseVersion(opencodeResult.result)
	};
}

async function updatePackages(sandbox: Sandbox): Promise<void> {
	await sandbox.process.executeCommand(`bun add -g ${BTCA_PACKAGE_NAME} ${OPENCODE_PACKAGE_NAME}`);
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
		try {
			const resources = await getResourceConfigs(ctx, args.instanceId);
			const daytona = getDaytona();
			sandbox = await daytona.create({
				snapshot: BTCA_SNAPSHOT_NAME,
				autoStopInterval: SANDBOX_IDLE_MINUTES,
				envVars: {
					NODE_ENV: 'production',
					OPENCODE_API_KEY: requireEnv('OPENCODE_API_KEY')
				},
				public: true
			});

			await uploadBtcaConfig(sandbox, resources);
			await startBtcaServer(sandbox);

			const versions = await getInstalledVersions(sandbox);
			await stopSandboxIfRunning(sandbox);

			await ctx.runMutation(instanceMutations.setProvisioned, {
				instanceId: args.instanceId,
				sandboxId: sandbox.id,
				btcaVersion: versions.btcaVersion,
				opencodeVersion: versions.opencodeVersion
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
					btcaVersion: versions.btcaVersion,
					opencodeVersion: versions.opencodeVersion
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

			const message = getErrorMessage(error);
			const durationMs = Date.now() - provisionStartedAt;

			await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
				distinctId: instance.clerkId,
				event: AnalyticsEvents.SANDBOX_PROVISIONING_FAILED,
				properties: {
					instanceId: args.instanceId,
					error: message,
					durationMs
				}
			});

			await ctx.runMutation(instanceMutations.setError, {
				instanceId: args.instanceId,
				errorMessage: message
			});
			throw new Error(message);
		}
	}
});

export const wake = action({
	args: instanceArgs,
	handler: async (ctx, args) => wakeInstanceInternal(ctx, args.instanceId)
});

export const stop = action({
	args: instanceArgs,
	handler: async (ctx, args) => stopInstanceInternal(ctx, args.instanceId)
});

export const update = action({
	args: instanceArgs,
	handler: async (ctx, args) => updateInstanceInternal(ctx, args.instanceId)
});

export const checkVersions = action({
	args: instanceArgs,
	handler: async (ctx, args) => {
		const instance = await requireInstance(ctx, args.instanceId);
		const [latestBtca, latestOpencode] = await Promise.all([
			fetchLatestVersion(BTCA_PACKAGE_NAME),
			fetchLatestVersion(OPENCODE_PACKAGE_NAME)
		]);

		await ctx.runMutation(instanceMutations.setVersions, {
			instanceId: args.instanceId,
			latestBtcaVersion: latestBtca,
			latestOpencodeVersion: latestOpencode,
			lastVersionCheck: Date.now()
		});

		const updateAvailable = Boolean(
			(latestBtca && instance.btcaVersion && latestBtca !== instance.btcaVersion) ||
			(latestOpencode && instance.opencodeVersion && latestOpencode !== instance.opencodeVersion)
		);

		return {
			latestBtca,
			latestOpencode,
			updateAvailable
		};
	}
});

export const destroy = action({
	args: instanceArgs,
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
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error('Unauthorized');
	}

	const instance = await ctx.runQuery(instanceQueries.getByClerkId, {});
	if (!instance) {
		throw new Error('Instance not found');
	}

	return instance;
}

async function createSandboxFromScratch(
	ctx: ActionCtx,
	instanceId: Id<'instances'>,
	instance: Doc<'instances'>
): Promise<{ sandbox: Sandbox; serverUrl: string }> {
	requireEnv('OPENCODE_API_KEY');

	const resources = await getResourceConfigs(ctx, instanceId);
	const daytona = getDaytona();
	const sandbox = await daytona.create({
		snapshot: BTCA_SNAPSHOT_NAME,
		autoStopInterval: SANDBOX_IDLE_MINUTES,
		envVars: {
			NODE_ENV: 'production',
			OPENCODE_API_KEY: requireEnv('OPENCODE_API_KEY')
		},
		public: true
	});

	await uploadBtcaConfig(sandbox, resources);
	const serverUrl = await startBtcaServer(sandbox);

	const versions = await getInstalledVersions(sandbox);

	await ctx.runMutation(instanceMutations.setProvisioned, {
		instanceId,
		sandboxId: sandbox.id,
		btcaVersion: versions.btcaVersion,
		opencodeVersion: versions.opencodeVersion
	});

	await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
		distinctId: instance.clerkId,
		event: AnalyticsEvents.SANDBOX_PROVISIONED,
		properties: {
			instanceId,
			sandboxId: sandbox.id,
			btcaVersion: versions.btcaVersion,
			opencodeVersion: versions.opencodeVersion,
			createdDuringWake: true
		}
	});

	return { sandbox, serverUrl };
}

async function wakeInstanceInternal(
	ctx: ActionCtx,
	instanceId: Id<'instances'>
): Promise<{ serverUrl: string }> {
	const instance = await requireInstance(ctx, instanceId);
	const wakeStartedAt = Date.now();

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
			const result = await createSandboxFromScratch(ctx, instanceId, instance);
			serverUrl = result.serverUrl;
			sandboxId = result.sandbox.id;
		} else {
			const resources = await getResourceConfigs(ctx, instanceId);
			const daytona = getDaytona();
			const sandbox = await daytona.get(instance.sandboxId);

			await ensureSandboxStarted(sandbox);
			await uploadBtcaConfig(sandbox, resources);
			serverUrl = await startBtcaServer(sandbox);
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
		const message = getErrorMessage(error);
		await ctx.runMutation(instanceMutations.setError, { instanceId, errorMessage: message });
		throw new Error(message);
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
		throw new Error(message);
	}
}

async function updateInstanceInternal(
	ctx: ActionCtx,
	instanceId: Id<'instances'>
): Promise<{ serverUrl?: string; updated?: boolean }> {
	const instance = await requireInstance(ctx, instanceId);
	if (!instance.sandboxId) {
		throw new Error('Instance does not have a sandbox to update');
	}

	await ctx.runMutation(instanceMutations.updateState, { instanceId, state: 'updating' });

	try {
		const resources = await getResourceConfigs(ctx, instanceId);
		const daytona = getDaytona();
		const sandbox = await daytona.get(instance.sandboxId);
		const wasRunning = await ensureSandboxStarted(sandbox);

		await updatePackages(sandbox);
		await uploadBtcaConfig(sandbox, resources);
		const versions = await getInstalledVersions(sandbox);

		await ctx.runMutation(instanceMutations.setVersions, {
			instanceId,
			btcaVersion: versions.btcaVersion,
			opencodeVersion: versions.opencodeVersion,
			latestBtcaVersion: versions.btcaVersion,
			latestOpencodeVersion: versions.opencodeVersion,
			lastVersionCheck: Date.now()
		});
		await ctx.runMutation(instanceMutations.touchActivity, { instanceId });

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.SANDBOX_UPDATED,
			properties: {
				instanceId,
				sandboxId: instance.sandboxId,
				btcaVersion: versions.btcaVersion,
				opencodeVersion: versions.opencodeVersion
			}
		});

		if (wasRunning) {
			await sandbox.process.executeCommand('pkill -f "btca serve" || true');
			const serverUrl = await startBtcaServer(sandbox);
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
		throw new Error(message);
	}
}

export const wakeMyInstance = action({
	args: {},
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
	handler: async (ctx, args): Promise<EnsureInstanceResult> => {
		let clerkId = args.clerkId;

		if (!clerkId) {
			const identity = await ctx.auth.getUserIdentity();
			if (!identity) {
				throw new Error('Unauthorized: No clerkId provided and user is not authenticated');
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
	handler: async (ctx): Promise<{ stopped: boolean }> => {
		const instance = await requireAuthenticatedInstance(ctx);
		return stopInstanceInternal(ctx, instance._id);
	}
});

export const updateMyInstance = action({
	args: {},
	handler: async (ctx): Promise<{ serverUrl?: string; updated?: boolean }> => {
		const instance = await requireAuthenticatedInstance(ctx);
		return updateInstanceInternal(ctx, instance._id);
	}
});

export const resetMyInstance = action({
	args: {},
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
	args: instanceArgs,
	handler: async (ctx, args): Promise<{ synced: boolean }> => {
		const instance = await requireInstance(ctx, args.instanceId);
		if (!instance.sandboxId || instance.state !== 'running') {
			return { synced: false };
		}

		try {
			const resources = await getResourceConfigs(ctx, args.instanceId);
			const daytona = getDaytona();
			const sandbox = await daytona.get(instance.sandboxId);

			if (sandbox.state !== 'started') {
				return { synced: false };
			}

			await uploadBtcaConfig(sandbox, resources);
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
