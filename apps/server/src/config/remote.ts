import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Result } from 'better-result';
import { z } from 'zod';

import { CommonHints, type TaggedErrorOptions } from '../errors.ts';
import { Metrics } from '../metrics/index.ts';
import { GitResourceSchema, type GitResource } from '../resources/schema.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Remote Config Constants
// ─────────────────────────────────────────────────────────────────────────────

export const REMOTE_CONFIG_FILENAME = 'btca.remote.config.jsonc';
export const REMOTE_AUTH_FILENAME = 'remote-auth.json';
export const REMOTE_CONFIG_SCHEMA_URL = 'https://btca.dev/btca.remote.schema.json';
export const GLOBAL_CONFIG_DIR = '~/.config/btca';

/**
 * Available models for remote mode (preset list).
 * These are subscription-based and managed by the cloud service.
 */
export const REMOTE_MODELS = [
	{ id: 'claude-sonnet', name: 'Claude Sonnet', description: 'Default, balanced performance' },
	{ id: 'claude-haiku', name: 'Claude Haiku', description: 'Faster and cheaper' },
	{ id: 'gpt-4o', name: 'GPT-4o', description: 'OpenAI GPT-4o' },
	{ id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Faster and cheaper' }
] as const;

export type RemoteModelId = (typeof REMOTE_MODELS)[number]['id'];

// ─────────────────────────────────────────────────────────────────────────────
// Remote Config Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Git resource for remote mode (only git resources are supported in remote mode)
 */
const RemoteGitResourceSchema = GitResourceSchema.omit({ type: true }).extend({
	type: z.literal('git').default('git')
});

export type RemoteGitResource = z.infer<typeof RemoteGitResourceSchema>;

/**
 * Remote config file schema (btca.remote.config.jsonc)
 */
export const RemoteConfigSchema = z.object({
	$schema: z.string().optional(),
	project: z.string().min(1, 'Project name is required'),
	model: z.enum(['claude-sonnet', 'claude-haiku', 'gpt-4o', 'gpt-4o-mini']).optional(),
	resources: z.array(RemoteGitResourceSchema).default([])
});

export type RemoteConfig = z.infer<typeof RemoteConfigSchema>;

/**
 * Remote auth storage schema (~/.config/btca/remote-auth.json)
 */
export const RemoteAuthSchema = z.object({
	apiKey: z.string().min(1),
	linkedAt: z.number()
});

export type RemoteAuth = z.infer<typeof RemoteAuthSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Error Class
// ─────────────────────────────────────────────────────────────────────────────

export class RemoteConfigError extends Error {
	readonly _tag = 'RemoteConfigError';
	override readonly cause?: unknown;
	readonly hint?: string;

	constructor(args: TaggedErrorOptions) {
		super(args.message);
		this.cause = args.cause;
		this.hint = args.hint;
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

const expandHome = (filePath: string): string => {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
	if (filePath.startsWith('~/')) return home + filePath.slice(1);
	return filePath;
};

const stripJsonc = (content: string): string => {
	// Remove // and /* */ comments without touching strings.
	let out = '';
	let i = 0;
	let inString = false;
	let quote: '"' | "'" | null = null;
	let escaped = false;

	while (i < content.length) {
		const ch = content[i] ?? '';
		const next = content[i + 1] ?? '';

		if (inString) {
			out += ch;
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (quote && ch === quote) {
				inString = false;
				quote = null;
			}
			i += 1;
			continue;
		}

		if (ch === '/' && next === '/') {
			i += 2;
			while (i < content.length && content[i] !== '\n') i += 1;
			continue;
		}

		if (ch === '/' && next === '*') {
			i += 2;
			while (i < content.length) {
				if (content[i] === '*' && content[i + 1] === '/') {
					i += 2;
					break;
				}
				i += 1;
			}
			continue;
		}

		if (ch === '"' || ch === "'") {
			inString = true;
			quote = ch;
			out += ch;
			i += 1;
			continue;
		}

		out += ch;
		i += 1;
	}

	// Remove trailing commas (outside strings).
	let normalized = '';
	inString = false;
	quote = null;
	escaped = false;
	i = 0;

	while (i < out.length) {
		const ch = out[i] ?? '';

		if (inString) {
			normalized += ch;
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (quote && ch === quote) {
				inString = false;
				quote = null;
			}
			i += 1;
			continue;
		}

		if (ch === '"' || ch === "'") {
			inString = true;
			quote = ch;
			normalized += ch;
			i += 1;
			continue;
		}

		if (ch === ',') {
			let j = i + 1;
			while (j < out.length && /\s/.test(out[j] ?? '')) j += 1;
			const nextNonWs = out[j] ?? '';
			if (nextNonWs === ']' || nextNonWs === '}') {
				i += 1;
				continue;
			}
		}

		normalized += ch;
		i += 1;
	}

	return normalized.trim();
};

const parseJsonc = (content: string): unknown => JSON.parse(stripJsonc(content));

const readJsonFile = (filePath: string) =>
	Result.gen(async function* () {
		const content = yield* Result.await(Result.tryPromise(() => Bun.file(filePath).text()));
		const parsed = yield* Result.try(() => JSON.parse(content));
		return Result.ok(parsed);
	});

const readJsoncFile = (filePath: string) =>
	Result.gen(async function* () {
		const content = yield* Result.await(Result.tryPromise(() => Bun.file(filePath).text()));
		const parsed = yield* Result.try(() => parseJsonc(content));
		return Result.ok(parsed);
	});

// ─────────────────────────────────────────────────────────────────────────────
// Remote Config Namespace
// ─────────────────────────────────────────────────────────────────────────────

export namespace RemoteConfigService {
	/**
	 * Get the path to the remote auth file
	 */
	export function getAuthPath(): string {
		return `${expandHome(GLOBAL_CONFIG_DIR)}/${REMOTE_AUTH_FILENAME}`;
	}

	/**
	 * Get the path to the remote config file in the current directory
	 */
	export function getConfigPath(cwd: string = process.cwd()): string {
		return `${cwd}/${REMOTE_CONFIG_FILENAME}`;
	}

	/**
	 * Check if the user is authenticated with remote
	 */
	export async function isAuthenticated(): Promise<boolean> {
		const authPath = getAuthPath();
		const result = await readJsonFile(authPath);
		return result.match({
			ok: (parsed) => {
				const authResult = RemoteAuthSchema.safeParse(parsed);
				return authResult.success && !!authResult.data.apiKey;
			},
			err: () => false
		});
	}

	/**
	 * Load the remote auth credentials
	 */
	export async function loadAuth(): Promise<RemoteAuth | null> {
		const authPath = getAuthPath();
		const result = await readJsonFile(authPath);
		return result.match({
			ok: (parsed) => {
				const authResult = RemoteAuthSchema.safeParse(parsed);
				if (!authResult.success) {
					Metrics.error('remote.auth.invalid', { path: authPath, error: authResult.error.message });
					return null;
				}
				return authResult.data;
			},
			err: () => null
		});
	}

	/**
	 * Save remote auth credentials
	 */
	export async function saveAuth(auth: RemoteAuth): Promise<void> {
		const authPath = getAuthPath();
		const configDir = path.dirname(authPath);

		const result = await Result.gen(async function* () {
			yield* Result.await(
				Result.tryPromise({
					try: () => fs.mkdir(configDir, { recursive: true }),
					catch: (cause) =>
						new RemoteConfigError({
							message: `Failed to save remote auth to: "${authPath}"`,
							hint: 'Check that you have write permissions to the config directory.',
							cause
						})
				})
			);

			yield* Result.await(
				Result.tryPromise({
					try: () => Bun.write(authPath, JSON.stringify(auth, null, 2)),
					catch: (cause) =>
						new RemoteConfigError({
							message: `Failed to save remote auth to: "${authPath}"`,
							hint: 'Check that you have write permissions to the config directory.',
							cause
						})
				})
			);

			yield* Result.await(
				Result.tryPromise({
					try: () => fs.chmod(authPath, 0o600),
					catch: (cause) =>
						new RemoteConfigError({
							message: `Failed to save remote auth to: "${authPath}"`,
							hint: 'Check that you have write permissions to the config directory.',
							cause
						})
				})
			);

			return Result.ok(undefined);
		});

		result.match({
			ok: () => Metrics.info('remote.auth.saved', { path: authPath }),
			err: (error) => {
				throw error;
			}
		});
	}

	/**
	 * Delete remote auth credentials (unlink)
	 */
	export async function deleteAuth(): Promise<void> {
		const authPath = getAuthPath();
		const result = await Result.tryPromise(() => fs.unlink(authPath));
		result.match({
			ok: () => Metrics.info('remote.auth.deleted', { path: authPath }),
			err: () => undefined
		});
	}

	/**
	 * Check if a remote config file exists in the current directory
	 */
	export async function configExists(cwd: string = process.cwd()): Promise<boolean> {
		const configPath = getConfigPath(cwd);
		return Bun.file(configPath).exists();
	}

	/**
	 * Load the remote config from the current directory
	 */
	export async function loadConfig(cwd: string = process.cwd()): Promise<RemoteConfig | null> {
		const configPath = getConfigPath(cwd);

		const result = await readJsoncFile(configPath);
		const parsed = result.match({
			ok: (value) => value,
			err: () => null
		});
		if (!parsed) return null;

		const parsedResult = RemoteConfigSchema.safeParse(parsed);
		if (!parsedResult.success) {
			const issues = parsedResult.error.issues
				.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
				.join('\n');
			throw new RemoteConfigError({
				message: `Invalid remote config structure:\n${issues}`,
				hint: `${CommonHints.CHECK_CONFIG} Required field: "project" (string).`,
				cause: parsedResult.error
			});
		}

		Metrics.info('remote.config.loaded', {
			path: configPath,
			project: parsedResult.data.project,
			resourceCount: parsedResult.data.resources.length
		});

		return parsedResult.data;
	}

	/**
	 * Save the remote config to the current directory
	 */
	export async function saveConfig(
		config: RemoteConfig,
		cwd: string = process.cwd()
	): Promise<void> {
		const configPath = getConfigPath(cwd);

		const toSave = {
			$schema: REMOTE_CONFIG_SCHEMA_URL,
			...config
		};

		const result = await Result.tryPromise({
			try: () => Bun.write(configPath, JSON.stringify(toSave, null, '\t')),
			catch: (cause) =>
				new RemoteConfigError({
					message: `Failed to save remote config to: "${configPath}"`,
					hint: 'Check that you have write permissions to the directory.',
					cause
				})
		});

		result.match({
			ok: () =>
				Metrics.info('remote.config.saved', {
					path: configPath,
					project: config.project,
					resourceCount: config.resources.length
				}),
			err: (error) => {
				throw error;
			}
		});
	}

	/**
	 * Create a new remote config with defaults
	 */
	export function createDefaultConfig(projectName: string): RemoteConfig {
		return {
			project: projectName,
			model: 'claude-haiku',
			resources: []
		};
	}

	/**
	 * Add a resource to the remote config
	 */
	export async function addResource(
		resource: GitResource,
		cwd: string = process.cwd()
	): Promise<RemoteConfig> {
		let config = await loadConfig(cwd);

		if (!config) {
			throw new RemoteConfigError({
				message: 'No remote config found in current directory',
				hint: `Create a remote config first with "btca remote init" or create a ${REMOTE_CONFIG_FILENAME} file.`
			});
		}

		// Check for duplicate
		if (config.resources.some((r) => r.name === resource.name)) {
			throw new RemoteConfigError({
				message: `Resource "${resource.name}" already exists in remote config`,
				hint: `Remove the existing resource first or use a different name.`
			});
		}

		config = {
			...config,
			resources: [...config.resources, resource]
		};

		await saveConfig(config, cwd);
		return config;
	}

	/**
	 * Remove a resource from the remote config
	 */
	export async function removeResource(
		name: string,
		cwd: string = process.cwd()
	): Promise<RemoteConfig> {
		let config = await loadConfig(cwd);

		if (!config) {
			throw new RemoteConfigError({
				message: 'No remote config found in current directory',
				hint: `Create a remote config first with "btca remote init" or create a ${REMOTE_CONFIG_FILENAME} file.`
			});
		}

		const existingIndex = config.resources.findIndex((r) => r.name === name);
		if (existingIndex === -1) {
			throw new RemoteConfigError({
				message: `Resource "${name}" not found in remote config`,
				hint: `Available resources: ${config.resources.map((r) => r.name).join(', ') || 'none'}`
			});
		}

		config = {
			...config,
			resources: config.resources.filter((r) => r.name !== name)
		};

		await saveConfig(config, cwd);
		return config;
	}

	/**
	 * Update the model in the remote config
	 */
	export async function updateModel(
		model: RemoteModelId,
		cwd: string = process.cwd()
	): Promise<RemoteConfig> {
		let config = await loadConfig(cwd);

		if (!config) {
			throw new RemoteConfigError({
				message: 'No remote config found in current directory',
				hint: `Create a remote config first with "btca remote init" or create a ${REMOTE_CONFIG_FILENAME} file.`
			});
		}

		config = { ...config, model };
		await saveConfig(config, cwd);
		return config;
	}
}
