'use node';

import { createClerkClient } from '@clerk/backend';
import { Daytona, type Sandbox } from '@daytonaio/sdk';
import { BTCA_SNAPSHOT_NAME } from 'btca-sandbox/shared';
import type { FunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { Result } from 'better-result';

import { api, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { action, internalAction, type ActionCtx } from '../_generated/server';
import { AnalyticsEvents } from '../analyticsEvents';
import { instances } from '../apiHelpers';
import {
	createInstallationToken,
	fetchGitHubRepo,
	getRepoFullName,
	parseGitHubRepoRef
} from '../githubApp';
import { privateAction, withPrivateApiKey } from '../privateWrappers';
import { getInstanceErrorKind, getUserFacingInstanceError } from '../../lib/instanceErrors';
import { getWebSandboxModel } from '../../lib/models/webSandboxModels.ts';
import {
	WebAuthError,
	WebConfigMissingError,
	WebUnhandledError,
	WebValidationError,
	type WebError
} from '../../lib/result/errors';
import { withInstanceRuntimeConfigLock } from '../runtimeConfigLock.js';

const instanceQueries = instances.queries;
const instanceMutations = instances.mutations;
const BTCA_SERVER_PORT = 3000;
const SANDBOX_IDLE_MINUTES = 2;
const BTCA_SERVER_SESSION = 'btca-server-session';
const BTCA_SERVER_LOG_PATH = '/tmp/btca-server.log';
const BTCA_PACKAGE_NAME = 'btca@latest';

const instanceArgs = { instanceId: v.id('instances') };

type ResourceConfig = {
	name: string;
	specialNotes?: string;
} & (
	| {
			type: 'git';
			url: string;
			branch: string;
			searchPath?: string;
			gitProvider?: 'github' | 'generic';
			visibility?: 'public' | 'private';
			authSource?: 'clerk_github_oauth' | 'github_app';
	  }
	| {
			type: 'npm';
			package: string;
			version?: string;
	  }
);

type InstalledVersions = {
	btcaVersion?: string;
};

type PreviewAccess = {
	serverUrl: string;
	previewToken?: string;
};

let daytonaInstance: Daytona | null = null;
type InstanceActionResult<T> = Result<T, WebError>;

type GitHubInstallationRecord = {
	installationId: number;
	repositorySelection: 'all' | 'selected';
	repositoryNames: string[];
	status: 'active' | 'suspended' | 'deleted';
};

const githubConnectionsInternal = internal as unknown as {
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
};

const getClerkClient = () => {
	const secretKey = process.env.CLERK_SECRET_KEY;
	if (!secretKey) {
		throw new WebConfigMissingError({
			message: 'CLERK_SECRET_KEY is not set in the Convex environment',
			config: 'CLERK_SECRET_KEY'
		});
	}
	return createClerkClient({ secretKey });
};

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

function generateBtcaConfig(resources: ResourceConfig[], model = getWebSandboxModel()): string {
	return JSON.stringify(
		{
			$schema: 'https://btca.dev/btca.schema.json',
			resources: resources.map((resource) =>
				resource.type === 'git'
					? {
							name: resource.name,
							type: resource.type,
							url: resource.url,
							branch: resource.branch || 'main',
							searchPath: resource.searchPath,
							specialNotes: resource.specialNotes
						}
					: {
							name: resource.name,
							type: resource.type,
							package: resource.package,
							version: resource.version,
							specialNotes: resource.specialNotes
						}
			),
			model: model.id,
			provider: model.provider
		},
		null,
		2
	);
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unknown error';
}

async function assertClerkUserExists(clerkId: string): Promise<void> {
	try {
		await getClerkClient().users.getUser(clerkId);
	} catch (error) {
		const status =
			typeof error === 'object' && error && 'status' in error ? error.status : undefined;
		if (status === 404) {
			throw new WebValidationError({
				message: `Clerk user "${clerkId}" does not exist`,
				field: 'clerkId'
			});
		}

		throw new WebUnhandledError({
			message: `Failed to verify Clerk user "${clerkId}"`,
			cause: error
		});
	}
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

const getErrorContext = (error: unknown): Record<string, unknown> | undefined => {
	if (!error || typeof error !== 'object') return undefined;
	const directContext =
		'context' in error ? (error as { context?: Record<string, unknown> }).context : undefined;
	if (directContext) {
		return directContext;
	}

	const cause = 'cause' in error ? (error as { cause?: unknown }).cause : undefined;
	return cause ? getErrorContext(cause) : undefined;
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
	if (Result.isError(result)) {
		throwInstanceError(result.error);
	}
	return (result as { value: T }).value;
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
					: operation === 'migrate'
						? 'Migrating'
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
				stop_sandbox: 'stopping the sandbox',
				delete_old_sandbox: 'cleaning up the previous sandbox'
			}[step]
		: undefined;
	const base = `${actionLabel} failed${stepLabel ? ` while ${stepLabel}` : ''}.`;
	const trimmed = truncate(detail, 160);
	return `${base}${trimmed ? ` ${trimmed}` : ''} Please retry.`;
};

const requiresSnapshotMigration = (instance: Doc<'instances'>) =>
	instance.snapshotName !== BTCA_SNAPSHOT_NAME;

async function setInstanceError(
	ctx: ActionCtx,
	instanceId: Id<'instances'>,
	error: unknown,
	fallbackMessage: string
) {
	const errorKind = getInstanceErrorKind(error);
	const errorMessage = getUserFacingInstanceError(error, fallbackMessage);

	await ctx.runMutation(
		instanceMutations.setError,
		withPrivateApiKey({
			instanceId,
			errorKind,
			errorMessage
		})
	);

	return { errorKind, errorMessage };
}

async function getResourceConfigs(
	ctx: ActionCtx,
	instanceId: Id<'instances'>,
	projectId?: Id<'projects'>,
	includePrivate = true
): Promise<ResourceConfig[]> {
	// If projectId is provided, get project-specific resources
	// Otherwise fall back to instance-level resources (for backwards compatibility)
	const resources = projectId
		? await ctx.runQuery(internal.resources.listAvailableForProject, { projectId, includePrivate })
		: await ctx.runQuery(internal.resources.listAvailableInternal, { instanceId, includePrivate });

	const merged = new Map<string, ResourceConfig>();
	for (const resource of [...resources.global, ...resources.custom]) {
		if (resource.type === 'npm' && resource.package) {
			merged.set(resource.name, {
				name: resource.name,
				type: 'npm',
				package: resource.package,
				version: resource.version ?? undefined,
				specialNotes: resource.specialNotes ?? undefined
			});
			continue;
		}

		if (!resource.url) continue;

		merged.set(resource.name, {
			name: resource.name,
			type: 'git',
			url: resource.url,
			branch: resource.branch ?? 'main',
			searchPath: resource.searchPath ?? undefined,
			specialNotes: resource.specialNotes ?? undefined,
			gitProvider: 'gitProvider' in resource ? (resource.gitProvider ?? undefined) : undefined,
			visibility: 'visibility' in resource ? (resource.visibility ?? undefined) : undefined,
			authSource: 'authSource' in resource ? (resource.authSource ?? undefined) : undefined
		});
	}
	return [...merged.values()];
}

async function getSandboxModelConfig(
	ctx: ActionCtx,
	instanceId: Id<'instances'>,
	projectId?: Id<'projects'>
) {
	if (!projectId) {
		return getWebSandboxModel();
	}

	const project = await ctx.runQuery(internal.projects.getInternal, { projectId });
	if (!project || project.instanceId !== instanceId) {
		throw new WebValidationError({ message: 'Project not found', field: 'projectId' });
	}

	return getWebSandboxModel(project.model);
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

async function uploadBtcaConfig(
	sandbox: Sandbox,
	resources: ResourceConfig[],
	model = getWebSandboxModel()
): Promise<void> {
	const config = generateBtcaConfig(resources, model);
	await sandbox.fs.uploadFile(Buffer.from(config), '/root/btca.config.jsonc');
}

const requiresGitHubAuth = (resources: ResourceConfig[]) =>
	resources.some(
		(resource) =>
			resource.type === 'git' &&
			resource.gitProvider === 'github' &&
			resource.visibility === 'private' &&
			(resource.authSource === 'clerk_github_oauth' || resource.authSource === 'github_app')
	);

const getClerkGitHubToken = async (clerkUserId: string) => {
	const oauthTokens = await getClerkClient().users.getUserOauthAccessToken(clerkUserId, 'github');
	const tokenData = oauthTokens.data[0];
	if (!tokenData?.token) {
		throw new WebAuthError({
			message: 'Reconnect any older private GitHub resources before using them in the web sandbox.',
			code: 'UNAUTHORIZED'
		});
	}

	return tokenData.token;
};

const escapeShellSingleQuoted = (value: string) => value.replace(/'/g, `'\\''`);

const buildGitHubCredentialHelperScript = (
	credentials: Array<{ owner: string; repo: string; token: string }>
) => {
	const cases = credentials
		.map(
			({ owner, repo, token }) => `  '${escapeShellSingleQuoted(`github.com:${owner}/${repo}`)}')
    printf '%s\n' 'username=x-access-token'
    printf '%s\n' 'password=${escapeShellSingleQuoted(token)}'
    exit 0
    ;;`
		)
		.join('\n');

	return `#!/bin/sh
host=""
path=""
while IFS='=' read -r key value; do
	case "$key" in
		host) host="$value" ;;
		path) path="$value" ;;
	esac
done

path="\${path#/}"
path="\${path%.git}"

case "$host:$path" in
${cases}
esac

exit 0
`;
};

async function syncGitHubAuth(
	ctx: ActionCtx,
	sandbox: Sandbox,
	instanceId: Id<'instances'>,
	clerkUserId: string,
	resources: ResourceConfig[]
) {
	if (!requiresGitHubAuth(resources)) {
		await sandbox.process.executeCommand(
			'rm -f /root/.netrc /root/.btca-github-credential-helper.sh && git config --global --unset-all credential.helper >/dev/null 2>&1 || true && git config --global --unset credential.useHttpPath >/dev/null 2>&1 || true'
		);
		return;
	}

	const credentials: Array<{ owner: string; repo: string; token: string }> = [];
	const installationTokenCache = new Map<number, string>();
	let clerkToken: string | null = null;

	for (const resource of resources) {
		if (
			resource.type !== 'git' ||
			resource.gitProvider !== 'github' ||
			resource.visibility !== 'private'
		) {
			continue;
		}

		const repoRef = parseGitHubRepoRef(resource.url);
		if (!repoRef) {
			continue;
		}

		if (resource.authSource === 'github_app') {
			const repoFullName = getRepoFullName(repoRef);
			const activeInstallations = (
				(await ctx.runQuery(githubConnectionsInternal.githubConnections.getByOwner, {
					instanceId,
					accountLogin: repoRef.owner.toLowerCase()
				})) as GitHubInstallationRecord[]
			).filter((installation) => installation.status === 'active');

			if (activeInstallations.length === 0) {
				throw new WebAuthError({
					message: `Connect GitHub and install the btca GitHub App on ${repoRef.owner} before using private repositories.`,
					code: 'UNAUTHORIZED'
				});
			}

			let token: string | null = null;
			for (const installation of activeInstallations) {
				if (
					installation.repositorySelection === 'selected' &&
					installation.repositoryNames.length > 0 &&
					!installation.repositoryNames.includes(repoFullName)
				) {
					continue;
				}

				token =
					installationTokenCache.get(installation.installationId) ??
					(await createInstallationToken(installation.installationId));
				installationTokenCache.set(installation.installationId, token);

				const repoResponse = await fetchGitHubRepo(repoRef, token);
				if (repoResponse.status === 404) {
					continue;
				}
				if (!repoResponse.ok) {
					throw new WebUnhandledError({
						message: `GitHub repository lookup failed with status ${repoResponse.status}`
					});
				}

				break;
			}

			if (!token) {
				throw new WebAuthError({
					message: `Grant the ${repoFullName} repository to the btca GitHub App before using private repositories.`,
					code: 'FORBIDDEN'
				});
			}

			credentials.push({ ...repoRef, token });
			continue;
		}

		if (!clerkToken) {
			clerkToken = await getClerkGitHubToken(clerkUserId);
		}

		credentials.push({ ...repoRef, token: clerkToken });
	}

	const helperPath = '/root/.btca-github-credential-helper.sh';
	const helperScript = buildGitHubCredentialHelperScript(credentials);
	await sandbox.fs.uploadFile(Buffer.from(helperScript), helperPath);
	await sandbox.process.executeCommand(`chmod 700 ${helperPath}`);
	await sandbox.process.executeCommand('rm -f /root/.netrc');
	await sandbox.process.executeCommand(
		`git config --global --unset-all credential.helper >/dev/null 2>&1 || true && git config --global credential.useHttpPath true && git config --global credential.helper '${helperPath}'`
	);
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

async function startBtcaServer(sandbox: Sandbox): Promise<PreviewAccess> {
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

	return await getPreviewAccessForSandbox(sandbox, undefined, 'start_btca');
}

async function getPreviewAccessForSandbox(
	sandbox: Sandbox,
	fallbackServerUrl?: string,
	step?: string
): Promise<PreviewAccess> {
	try {
		const previewInfo = await sandbox.getPreviewLink(BTCA_SERVER_PORT);
		return {
			serverUrl: previewInfo.url,
			previewToken: previewInfo.token || undefined
		};
	} catch (error) {
		if (fallbackServerUrl) {
			return { serverUrl: fallbackServerUrl };
		}
		throw step ? attachErrorContext(error, { step }) : error;
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

async function createPreparedSandbox(
	ctx: ActionCtx,
	instanceId: Id<'instances'>,
	instance: Doc<'instances'>,
	includePrivate = true
): Promise<{ sandbox: Sandbox; versions: InstalledVersions }> {
	requireEnv('OPENCODE_API_KEY');

	let sandbox: Sandbox | null = null;
	let step = 'load_resources';

	try {
		const resources = unwrapInstance(
			await withStep(step, () => getResourceConfigs(ctx, instanceId, undefined, includePrivate))
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
					public: false
				})
			)
		);
		sandbox = createdSandbox;

		step = 'upload_config';
		unwrapInstance(
			await withStep(step, () =>
				syncGitHubAuth(ctx, createdSandbox, instanceId, instance.clerkId, resources)
			)
		);
		step = 'upload_config';
		unwrapInstance(await withStep(step, () => uploadBtcaConfig(createdSandbox, resources)));
		step = 'get_versions';
		const versions = unwrapInstance(
			await withStep(step, () => getInstalledVersions(createdSandbox))
		);
		step = 'stop_sandbox';
		unwrapInstance(await withStep(step, () => stopSandboxIfRunning(createdSandbox)));

		return { sandbox: createdSandbox, versions };
	} catch (error) {
		if (sandbox) {
			try {
				await sandbox.delete(60);
			} catch {
				// Ignore cleanup errors.
			}
		}
		throw error;
	}
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

export const provision = privateAction({
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

		await ctx.runMutation(
			instanceMutations.updateState,
			withPrivateApiKey({
				instanceId: args.instanceId,
				state: 'provisioning'
			})
		);

		let sandbox: Sandbox | null = null;
		let step = 'create_sandbox';
		try {
			const preparedSandbox = await createPreparedSandbox(ctx, args.instanceId, instance);
			sandbox = preparedSandbox.sandbox;
			const versions = preparedSandbox.versions;

			await ctx.runMutation(
				instanceMutations.setProvisioned,
				withPrivateApiKey({
					instanceId: args.instanceId,
					sandboxId: sandbox.id,
					snapshotName: BTCA_SNAPSHOT_NAME,
					btcaVersion: versions.btcaVersion
				})
			);
			await ctx.runMutation(
				instanceMutations.touchActivity,
				withPrivateApiKey({
					instanceId: args.instanceId
				})
			);

			// Schedule an update to ensure packages are up to date (snapshot may have older versions)
			await ctx.scheduler.runAfter(
				0,
				instances.actions.update,
				withPrivateApiKey({
					instanceId: args.instanceId
				})
			);

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

			const { errorMessage } = await setInstanceError(ctx, args.instanceId, error, message);
			throw new WebUnhandledError({ message: errorMessage });
		}
	}
});

export const wake = privateAction({
	args: {
		instanceId: v.id('instances'),
		projectId: v.optional(v.id('projects')),
		includePrivate: v.optional(v.boolean())
	},
	returns: v.object({ serverUrl: v.string() }),
	handler: async (ctx, args) =>
		wakeInstanceInternal(ctx, args.instanceId, args.projectId, args.includePrivate ?? true)
});

export const stop = privateAction({
	args: instanceArgs,
	returns: v.object({ stopped: v.boolean() }),
	handler: async (ctx, args) => stopInstanceInternal(ctx, args.instanceId)
});

export const update = privateAction({
	args: instanceArgs,
	returns: v.object({
		serverUrl: v.optional(v.string()),
		updated: v.optional(v.boolean())
	}),
	handler: async (ctx, args) => updateInstanceInternal(ctx, args.instanceId)
});

export const checkVersions = privateAction({
	args: instanceArgs,
	returns: v.object({
		latestBtca: v.optional(v.string()),
		updateAvailable: v.boolean()
	}),
	handler: async (ctx, args) => {
		const instance = await requireInstance(ctx, args.instanceId);
		const latestBtca = await fetchLatestVersion(BTCA_PACKAGE_NAME);

		await ctx.runMutation(
			instanceMutations.setVersions,
			withPrivateApiKey({
				instanceId: args.instanceId,
				latestBtcaVersion: latestBtca,
				lastVersionCheck: Date.now()
			})
		);

		const updateAvailable = Boolean(
			latestBtca && instance.btcaVersion && latestBtca !== instance.btcaVersion
		);

		return {
			latestBtca,
			updateAvailable
		};
	}
});

export const destroy = privateAction({
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

		await ctx.runMutation(
			instanceMutations.setServerUrl,
			withPrivateApiKey({
				instanceId: args.instanceId,
				serverUrl: ''
			})
		);
		await ctx.runMutation(
			instanceMutations.updateState,
			withPrivateApiKey({
				instanceId: args.instanceId,
				state: 'unprovisioned'
			})
		);

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
	instance: Doc<'instances'>,
	projectId?: Id<'projects'>,
	includePrivate = true
): Promise<{ sandbox: Sandbox; serverUrl: string }> {
	requireEnv('OPENCODE_API_KEY');

	let step = 'load_resources';
	const resources = unwrapInstance(
		await withStep(step, () => getResourceConfigs(ctx, instanceId, projectId, includePrivate))
	);
	const model = await getSandboxModelConfig(ctx, instanceId, projectId);
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
				public: false
			})
		)
	);

	step = 'upload_config';
	unwrapInstance(
		await withStep(step, () =>
			syncGitHubAuth(ctx, sandbox, instanceId, instance.clerkId, resources)
		)
	);
	step = 'upload_config';
	unwrapInstance(await withStep(step, () => uploadBtcaConfig(sandbox, resources, model)));
	step = 'start_btca';
	const serverUrl = unwrapInstance(await withStep(step, () => startBtcaServer(sandbox))).serverUrl;
	step = 'get_versions';
	const versions = unwrapInstance(await withStep(step, () => getInstalledVersions(sandbox)));

	await ctx.runMutation(
		instanceMutations.setProvisioned,
		withPrivateApiKey({
			instanceId,
			sandboxId: sandbox.id,
			snapshotName: BTCA_SNAPSHOT_NAME,
			btcaVersion: versions.btcaVersion
		})
	);

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
	projectId?: Id<'projects'>,
	includePrivate = true
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

	await ctx.runMutation(
		instanceMutations.updateState,
		withPrivateApiKey({
			instanceId,
			state: 'starting'
		})
	);

	try {
		let serverUrl: string;
		let sandboxId: string;

		if (!instance.sandboxId) {
			step = 'create_sandbox';
			const result = await createSandboxFromScratch(
				ctx,
				instanceId,
				instance,
				projectId,
				includePrivate
			);
			serverUrl = result.serverUrl;
			sandboxId = result.sandbox.id;
		} else {
			// Use project-specific resources if projectId is provided
			step = 'load_resources';
			const resources = unwrapInstance(
				await withStep(step, () => getResourceConfigs(ctx, instanceId, projectId, includePrivate))
			);
			const model = await getSandboxModelConfig(ctx, instanceId, projectId);
			const daytona = getDaytona();
			step = 'get_sandbox';
			const sandbox = await daytona.get(instance.sandboxId);

			step = 'start_sandbox';
			unwrapInstance(await withStep(step, () => ensureSandboxStarted(sandbox)));
			step = 'upload_config';
			unwrapInstance(
				await withStep(step, () =>
					syncGitHubAuth(ctx, sandbox, instanceId, instance.clerkId, resources)
				)
			);
			step = 'upload_config';
			unwrapInstance(await withStep(step, () => uploadBtcaConfig(sandbox, resources, model)));
			step = 'start_btca';
			serverUrl = unwrapInstance(await withStep(step, () => startBtcaServer(sandbox))).serverUrl;
			sandboxId = instance.sandboxId;
		}

		await ctx.runMutation(
			instanceMutations.setServerUrl,
			withPrivateApiKey({ instanceId, serverUrl })
		);
		await ctx.runMutation(
			instanceMutations.updateState,
			withPrivateApiKey({ instanceId, state: 'running' })
		);
		await ctx.runMutation(instanceMutations.touchActivity, withPrivateApiKey({ instanceId }));

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

		const { errorMessage } = await setInstanceError(ctx, instanceId, error, message);
		throw new WebUnhandledError({ message: errorMessage });
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

	await ctx.runMutation(
		instanceMutations.updateState,
		withPrivateApiKey({ instanceId, state: 'stopping' })
	);

	try {
		const daytona = getDaytona();
		const sandbox = await daytona.get(instance.sandboxId);
		await stopSandboxIfRunning(sandbox);

		await ctx.runMutation(
			instanceMutations.setServerUrl,
			withPrivateApiKey({ instanceId, serverUrl: '' })
		);
		await ctx.runMutation(
			instanceMutations.updateState,
			withPrivateApiKey({ instanceId, state: 'stopped' })
		);
		await ctx.runMutation(instanceMutations.touchActivity, withPrivateApiKey({ instanceId }));

		return { stopped: true };
	} catch (error) {
		const message = getErrorMessage(error);
		const { errorMessage } = await setInstanceError(ctx, instanceId, error, message);
		throw new WebUnhandledError({ message: errorMessage });
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

	await ctx.runMutation(
		instanceMutations.updateState,
		withPrivateApiKey({ instanceId, state: 'updating' })
	);

	try {
		const resources = await getResourceConfigs(ctx, instanceId);
		const daytona = getDaytona();
		const sandbox = await daytona.get(instance.sandboxId);
		let step = 'start_sandbox';
		const wasRunning = unwrapInstance(await withStep(step, () => ensureSandboxStarted(sandbox)));

		await updatePackages(sandbox);
		step = 'upload_config';
		unwrapInstance(
			await withStep(step, () =>
				syncGitHubAuth(ctx, sandbox, instanceId, instance.clerkId, resources)
			)
		);
		step = 'upload_config';
		unwrapInstance(await withStep(step, () => uploadBtcaConfig(sandbox, resources)));
		step = 'get_versions';
		const versions = unwrapInstance(await withStep(step, () => getInstalledVersions(sandbox)));

		await ctx.runMutation(
			instanceMutations.setVersions,
			withPrivateApiKey({
				instanceId,
				btcaVersion: versions.btcaVersion,
				latestBtcaVersion: versions.btcaVersion,
				lastVersionCheck: Date.now()
			})
		);
		await ctx.runMutation(instanceMutations.touchActivity, withPrivateApiKey({ instanceId }));

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
			).serverUrl;
			await ctx.runMutation(
				instanceMutations.setServerUrl,
				withPrivateApiKey({ instanceId, serverUrl })
			);
			await ctx.runMutation(
				instanceMutations.updateState,
				withPrivateApiKey({ instanceId, state: 'running' })
			);
			return { serverUrl };
		}

		await stopSandboxIfRunning(sandbox);
		await ctx.runMutation(
			instanceMutations.setServerUrl,
			withPrivateApiKey({ instanceId, serverUrl: '' })
		);
		await ctx.runMutation(
			instanceMutations.updateState,
			withPrivateApiKey({ instanceId, state: 'stopped' })
		);

		return { updated: true };
	} catch (error) {
		const message = getErrorMessage(error);
		const { errorMessage } = await setInstanceError(ctx, instanceId, error, message);
		throw new WebUnhandledError({ message: errorMessage });
	}
}

export const migrate = privateAction({
	args: instanceArgs,
	returns: v.object({ sandboxId: v.string() }),
	handler: async (ctx, args) => {
		const instance = await requireInstance(ctx, args.instanceId);
		const previousSandboxId = instance.sandboxId;
		const migrationStartedAt = Date.now();
		let sandbox: Sandbox | null = null;
		let step = 'create_sandbox';

		await ctx.runMutation(
			instanceMutations.updateState,
			withPrivateApiKey({ instanceId: args.instanceId, state: 'provisioning' })
		);
		await ctx.runMutation(
			instanceMutations.setServerUrl,
			withPrivateApiKey({ instanceId: args.instanceId, serverUrl: '' })
		);
		await ctx.runMutation(
			instanceMutations.clearError,
			withPrivateApiKey({ instanceId: args.instanceId })
		);

		try {
			const preparedSandbox = await createPreparedSandbox(ctx, args.instanceId, instance);
			sandbox = preparedSandbox.sandbox;
			const versions = preparedSandbox.versions;

			await ctx.runMutation(
				instanceMutations.setProvisioned,
				withPrivateApiKey({
					instanceId: args.instanceId,
					sandboxId: sandbox.id,
					snapshotName: BTCA_SNAPSHOT_NAME,
					btcaVersion: versions.btcaVersion
				})
			);
			await ctx.runMutation(
				instanceMutations.touchActivity,
				withPrivateApiKey({ instanceId: args.instanceId })
			);
			await ctx.scheduler.runAfter(
				0,
				instances.actions.update,
				withPrivateApiKey({ instanceId: args.instanceId })
			);

			if (previousSandboxId) {
				step = 'delete_old_sandbox';
				try {
					const previousSandbox = await getDaytona().get(previousSandboxId);
					await previousSandbox.delete(60);
				} catch {
					// Ignore cleanup errors for the previous sandbox.
				}
			}

			console.log('Sandbox migration completed', {
				instanceId: args.instanceId,
				previousSandboxId,
				newSandboxId: sandbox.id,
				durationMs: Date.now() - migrationStartedAt
			});

			return { sandboxId: sandbox.id };
		} catch (error) {
			const message = formatUserMessage('migrate', step, getErrorMessage(error));
			console.error('Sandbox migration failed', {
				instanceId: args.instanceId,
				previousSandboxId,
				newSandboxId: sandbox?.id,
				step,
				durationMs: Date.now() - migrationStartedAt,
				error: getErrorDetails(error),
				context: getErrorContext(error)
			});
			const { errorMessage } = await setInstanceError(ctx, args.instanceId, error, message);
			throw new WebUnhandledError({ message: errorMessage });
		}
	}
});

async function maybeScheduleSnapshotMigration(
	ctx: ActionCtx,
	instance: Doc<'instances'>
): Promise<boolean> {
	if (!requiresSnapshotMigration(instance)) {
		return false;
	}

	if (instance.state === 'unprovisioned' || instance.state === 'provisioning') {
		return false;
	}

	await ctx.runMutation(
		instanceMutations.updateState,
		withPrivateApiKey({ instanceId: instance._id, state: 'provisioning' })
	);
	await ctx.runMutation(
		instanceMutations.setServerUrl,
		withPrivateApiKey({ instanceId: instance._id, serverUrl: '' })
	);
	await ctx.runMutation(
		instanceMutations.clearError,
		withPrivateApiKey({ instanceId: instance._id })
	);
	await ctx.scheduler.runAfter(
		0,
		instances.actions.migrate,
		withPrivateApiKey({ instanceId: instance._id })
	);

	return true;
}

export const wakeMyInstance = action({
	args: {
		projectId: v.optional(v.id('projects'))
	},
	returns: v.object({ serverUrl: v.string() }),
	handler: async (ctx, args): Promise<{ serverUrl: string }> => {
		const instance = await requireAuthenticatedInstance(ctx);
		return wakeInstanceInternal(ctx, instance._id, args.projectId);
	}
});

export const applyProjectRuntimeConfig = action({
	args: {
		projectId: v.id('projects')
	},
	returns: v.object({
		applied: v.boolean(),
		appliesOnWake: v.boolean()
	}),
	handler: async (
		ctx,
		args
	): Promise<{
		applied: boolean;
		appliesOnWake: boolean;
	}> => {
		const instance = await requireAuthenticatedInstance(ctx);
		const project: Doc<'projects'> | null = await ctx.runQuery(internal.projects.getInternal, {
			projectId: args.projectId
		});

		if (!project || project.instanceId !== instance._id) {
			throw new WebValidationError({ message: 'Project not found', field: 'projectId' });
		}

		if (instance.state !== 'running' || !instance.sandboxId || !instance.serverUrl) {
			return {
				applied: false,
				appliesOnWake: true
			};
		}

		const result = await withInstanceRuntimeConfigLock(
			instance._id.toString(),
			async () =>
				(await ctx.runAction(internal.instances.actions.syncResources, {
					instanceId: instance._id,
					projectId: args.projectId,
					includePrivate: true
				})) as { synced: boolean }
		);

		return {
			applied: result.synced,
			appliesOnWake: !result.synced
		};
	}
});

type EnsureInstanceResult = {
	instanceId: Id<'instances'>;
	status: 'created' | 'exists' | 'provisioning';
};

export const ensureInstanceExists = action({
	args: {},
	returns: v.object({
		instanceId: v.id('instances'),
		status: v.union(v.literal('created'), v.literal('exists'), v.literal('provisioning'))
	}),
	handler: async (ctx): Promise<EnsureInstanceResult> => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			throw new WebAuthError({
				message: 'Authentication required',
				code: 'UNAUTHORIZED'
			});
		}

		const clerkId = identity.subject;

		const existing = await ctx.runQuery(instanceQueries.getByClerkId, {});

		if (existing) {
			let provisionScheduled = false;
			if (existing.state === 'unprovisioned') {
				await ctx.runMutation(
					instanceMutations.updateState,
					withPrivateApiKey({ instanceId: existing._id, state: 'provisioning' })
				);
				await ctx.runMutation(
					instanceMutations.setServerUrl,
					withPrivateApiKey({ instanceId: existing._id, serverUrl: '' })
				);
				await ctx.runMutation(
					instanceMutations.clearError,
					withPrivateApiKey({ instanceId: existing._id })
				);
				await ctx.scheduler.runAfter(
					0,
					instances.actions.provision,
					withPrivateApiKey({ instanceId: existing._id })
				);
				provisionScheduled = true;
			}
			const migrationScheduled = await maybeScheduleSnapshotMigration(ctx, existing);
			const isProvisioning =
				provisionScheduled ||
				migrationScheduled ||
				existing.state === 'unprovisioned' ||
				existing.state === 'provisioning';
			return {
				instanceId: existing._id,
				status: isProvisioning ? 'provisioning' : 'exists'
			};
		}

		const instanceId = await ctx.runMutation(
			instanceMutations.create,
			withPrivateApiKey({ clerkId })
		);

		await ctx.scheduler.runAfter(0, instances.actions.provision, withPrivateApiKey({ instanceId }));

		return {
			instanceId,
			status: 'created'
		};
	}
});

export const ensureInstanceExistsPrivate = privateAction({
	args: { clerkId: v.string() },
	returns: v.object({
		instanceId: v.id('instances'),
		status: v.union(v.literal('created'), v.literal('exists'), v.literal('provisioning'))
	}),
	handler: async (ctx, args): Promise<EnsureInstanceResult> => {
		await assertClerkUserExists(args.clerkId);

		const existing = await ctx.runQuery(instances.internalQueries.getByClerkIdInternal, {
			clerkId: args.clerkId
		});

		if (existing) {
			let provisionScheduled = false;
			if (existing.state === 'unprovisioned') {
				await ctx.runMutation(
					instanceMutations.updateState,
					withPrivateApiKey({ instanceId: existing._id, state: 'provisioning' })
				);
				await ctx.runMutation(
					instanceMutations.setServerUrl,
					withPrivateApiKey({ instanceId: existing._id, serverUrl: '' })
				);
				await ctx.runMutation(
					instanceMutations.clearError,
					withPrivateApiKey({ instanceId: existing._id })
				);
				await ctx.scheduler.runAfter(
					0,
					instances.actions.provision,
					withPrivateApiKey({ instanceId: existing._id })
				);
				provisionScheduled = true;
			}
			const migrationScheduled = await maybeScheduleSnapshotMigration(ctx, existing);
			const isProvisioning =
				provisionScheduled ||
				migrationScheduled ||
				existing.state === 'unprovisioned' ||
				existing.state === 'provisioning';
			return {
				instanceId: existing._id,
				status: isProvisioning ? 'provisioning' : 'exists'
			};
		}

		const instanceId = await ctx.runMutation(
			instanceMutations.create,
			withPrivateApiKey({ clerkId: args.clerkId })
		);

		await ctx.scheduler.runAfter(0, instances.actions.provision, withPrivateApiKey({ instanceId }));

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

		await ctx.runMutation(
			instanceMutations.updateState,
			withPrivateApiKey({
				instanceId: instance._id,
				state: 'provisioning'
			})
		);

		if (sandboxId) {
			const daytona = getDaytona();
			try {
				const sandbox = await daytona.get(sandboxId);
				await sandbox.delete(60);
			} catch {
				// Ignore deletion errors - sandbox may already be gone
			}
		}

		await ctx.runMutation(
			instanceMutations.setServerUrl,
			withPrivateApiKey({
				instanceId: instance._id,
				serverUrl: ''
			})
		);

		await ctx.runMutation(
			instanceMutations.clearError,
			withPrivateApiKey({
				instanceId: instance._id
			})
		);

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.SANDBOX_RESET,
			properties: {
				instanceId: instance._id,
				previousSandboxId: sandboxId
			}
		});

		await ctx.scheduler.runAfter(
			0,
			instances.actions.provision,
			withPrivateApiKey({
				instanceId: instance._id
			})
		);

		return { reset: true };
	}
});

export const syncResources = internalAction({
	args: {
		instanceId: v.id('instances'),
		projectId: v.optional(v.id('projects')),
		includePrivate: v.optional(v.boolean())
	},
	returns: v.object({ synced: v.boolean() }),
	handler: async (ctx, args): Promise<{ synced: boolean }> => {
		const instance = await requireInstance(ctx, args.instanceId);
		if (!instance.sandboxId || instance.state !== 'running' || !instance.serverUrl) {
			return { synced: false };
		}

		try {
			// Get project-specific resources if projectId is provided
			const resources = await getResourceConfigs(
				ctx,
				args.instanceId,
				args.projectId,
				args.includePrivate ?? true
			);
			const model = await getSandboxModelConfig(ctx, args.instanceId, args.projectId);
			const daytona = getDaytona();
			const sandbox = await daytona.get(instance.sandboxId);

			if (sandbox.state !== 'started') {
				return { synced: false };
			}

			// Upload the config and reload the server
			await syncGitHubAuth(ctx, sandbox, args.instanceId, instance.clerkId, resources);
			await uploadBtcaConfig(sandbox, resources, model);
			const previewAccess = await getPreviewAccessForSandbox(
				sandbox,
				instance.serverUrl ?? undefined
			);

			// Tell the btca server to reload its config
			const reloadResponse = await fetch(`${previewAccess.serverUrl}/reload-config`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(previewAccess.previewToken
						? { 'x-daytona-preview-token': previewAccess.previewToken }
						: {})
				}
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

export const getPreviewAccess = internalAction({
	args: instanceArgs,
	returns: v.object({
		serverUrl: v.string(),
		previewToken: v.optional(v.string())
	}),
	handler: async (ctx, args): Promise<PreviewAccess> => {
		const instance = await requireInstance(ctx, args.instanceId);
		if (!instance.sandboxId) {
			if (instance.serverUrl) {
				return { serverUrl: instance.serverUrl };
			}
			throw new WebUnhandledError({ message: 'Instance does not have a sandbox' });
		}

		const daytona = getDaytona();
		const sandbox = await daytona.get(instance.sandboxId);
		return await getPreviewAccessForSandbox(sandbox, instance.serverUrl ?? undefined);
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

			await ctx.runMutation(
				instanceMutations.updateStorageUsed,
				withPrivateApiKey({
					instanceId: args.instanceId,
					storageUsedBytes: status.storageUsedBytes
				})
			);

			if (status.cachedResources.length > 0) {
				await ctx.runMutation(
					instanceMutations.upsertCachedResources,
					withPrivateApiKey({
						instanceId: args.instanceId,
						resources: status.cachedResources
					})
				);
			}

			return status;
		} catch (error) {
			console.error('Failed to sync sandbox status:', getErrorMessage(error));
			return null;
		}
	}
});
