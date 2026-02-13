import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Result } from 'better-result';
import { z } from 'zod';

import { CommonHints, type TaggedErrorOptions } from '../errors.ts';
import { Metrics } from '../metrics/index.ts';
import { getSupportedProviders, isProviderSupported } from '../providers/index.ts';
import { ResourceDefinitionSchema, type ResourceDefinition } from '../resources/schema.ts';

export const GLOBAL_CONFIG_DIR = '~/.config/btca';
export const GLOBAL_CONFIG_FILENAME = 'btca.config.jsonc';
export const LEGACY_CONFIG_FILENAME = 'btca.json';
export const GLOBAL_DATA_DIR = '~/.local/share/btca';
export const PROJECT_CONFIG_FILENAME = 'btca.config.jsonc';
export const CONFIG_SCHEMA_URL = 'https://btca.dev/btca.schema.json';

export const DEFAULT_MODEL = 'claude-haiku-4-5';
export const DEFAULT_PROVIDER = 'opencode';
export const DEFAULT_PROVIDER_TIMEOUT_MS = 300_000;

export const DEFAULT_RESOURCES: ResourceDefinition[] = [
	{
		name: 'svelte',
		specialNotes:
			'This is the svelte docs website repo, not the actual svelte repo. Focus on the content directory, it has all the markdown files for the docs.',
		type: 'git',
		url: 'https://github.com/sveltejs/svelte.dev',
		branch: 'main',
		searchPath: 'apps/svelte.dev'
	},
	{
		name: 'tailwindcss',
		specialNotes:
			'This is the tailwindcss docs website repo, not the actual tailwindcss repo. Use the docs to answer questions about tailwindcss.',
		type: 'git',
		url: 'https://github.com/tailwindlabs/tailwindcss.com',
		searchPath: 'src/docs',
		branch: 'main'
	},
	{
		type: 'git',
		name: 'nextjs',
		url: 'https://github.com/vercel/next.js',
		branch: 'canary',
		searchPath: 'docs',
		specialNotes:
			'These are the docs for the next.js framework, not the actual next.js repo. Use the docs to answer questions about next.js.'
	}
];

const ProviderOptionsSchema = z.object({
	baseURL: z.string().optional(),
	name: z.string().optional()
});

const ProviderOptionsMapSchema = z.record(z.string(), ProviderOptionsSchema);

const StoredConfigSchema = z.object({
	$schema: z.string().optional(),
	dataDirectory: z.string().optional(),
	providerTimeoutMs: z.number().int().positive().optional(),
	resources: z.array(ResourceDefinitionSchema),
	// Provider and model are optional - defaults are applied when loading
	model: z.string().optional(),
	provider: z.string().optional(),
	providerOptions: ProviderOptionsMapSchema.optional()
});

type StoredConfig = z.infer<typeof StoredConfigSchema>;
type ProviderOptionsConfig = z.infer<typeof ProviderOptionsSchema>;
type ProviderOptionsMap = z.infer<typeof ProviderOptionsMapSchema>;
type ConfigScope = 'project' | 'global';

// Legacy config schemas (btca.json format from old CLI)
// There are two legacy formats:
// 1. Very old: has "repos" array with git repos only
// 2. Intermediate: has "resources" array (already migrated repos->resources but different file name)

const LegacyRepoSchema = z.object({
	name: z.string(),
	url: z.string(),
	branch: z.string(),
	specialNotes: z.string().optional(),
	searchPath: z.string().optional()
});

// Very old format with "repos"
const LegacyReposConfigSchema = z.object({
	$schema: z.string().optional(),
	reposDirectory: z.string().optional(),
	workspacesDirectory: z.string().optional(),
	dataDirectory: z.string().optional(),
	port: z.number().optional(),
	maxInstances: z.number().optional(),
	repos: z.array(LegacyRepoSchema),
	model: z.string(),
	provider: z.string()
});

// Intermediate format with "resources" (same as new format, just different filename)
const LegacyResourcesConfigSchema = z.object({
	$schema: z.string().optional(),
	dataDirectory: z.string().optional(),
	resources: z.array(ResourceDefinitionSchema),
	model: z.string(),
	provider: z.string()
});

type LegacyReposConfig = z.infer<typeof LegacyReposConfigSchema>;
type LegacyResourcesConfig = z.infer<typeof LegacyResourcesConfigSchema>;
type LegacyRepo = z.infer<typeof LegacyRepoSchema>;

export namespace Config {
	export class ConfigError extends Error {
		readonly _tag = 'ConfigError';
		override readonly cause?: unknown;
		readonly hint?: string;

		constructor(args: TaggedErrorOptions) {
			super(args.message);
			this.cause = args.cause;
			this.hint = args.hint;
		}
	}

	export type Service = {
		resourcesDirectory: string;
		resources: readonly ResourceDefinition[];
		model: string;
		provider: string;
		providerTimeoutMs?: number;
		configPath: string;
		getProviderOptions: (providerId: string) => ProviderOptionsConfig | undefined;
		getResource: (name: string) => ResourceDefinition | undefined;
		updateModel: (
			provider: string,
			model: string,
			providerOptions?: ProviderOptionsConfig
		) => Promise<{ provider: string; model: string; savedTo: ConfigScope }>;
		addResource: (resource: ResourceDefinition) => Promise<ResourceDefinition>;
		removeResource: (name: string) => Promise<void>;
		clearResources: () => Promise<{ cleared: number }>;
		reload: () => Promise<void>;
	};

	const expandHome = (path: string): string => {
		const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
		if (path.startsWith('~/')) return home + path.slice(1);
		return path;
	};

	const resolveDataDirectory = (rawPath: string, baseDir: string): string => {
		const expanded = expandHome(rawPath);
		if (path.isAbsolute(expanded)) return expanded;
		return path.resolve(baseDir, expanded);
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

	const readConfigText = (configPath: string) =>
		Result.tryPromise({
			try: () => Bun.file(configPath).text(),
			catch: (cause) =>
				new ConfigError({
					message: `Failed to read config file: "${configPath}"`,
					hint: 'Check that the file exists and you have read permissions.',
					cause
				})
		});

	const parseConfigText = (configPath: string, content: string) =>
		Result.try({
			try: () => parseJsonc(content),
			catch: (cause) =>
				new ConfigError({
					message: 'Failed to parse config file - invalid JSON syntax',
					hint: `Check "${configPath}" for syntax errors like missing commas, brackets, or quotes.`,
					cause
				})
		});

	const validateStoredConfig = (parsed: unknown) => {
		const result = StoredConfigSchema.safeParse(parsed);
		if (result.success) return Result.ok(result.data);
		const issues = result.error.issues
			.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
			.join('\n');
		return Result.err(
			new ConfigError({
				message: `Invalid config structure:\n${issues}`,
				hint: `${CommonHints.CHECK_CONFIG} Required fields: "resources" (array), "model" (string), "provider" (string).`,
				cause: result.error
			})
		);
	};

	const writeConfigFile = (
		configPath: string,
		stored: StoredConfig,
		message: string,
		hint: string
	) =>
		Result.tryPromise({
			try: () => Bun.write(configPath, JSON.stringify(stored, null, 2)),
			catch: (cause) =>
				new ConfigError({
					message,
					hint,
					cause
				})
		});

	/**
	 * Convert a legacy repo to a git resource
	 */
	const legacyRepoToResource = (repo: LegacyRepo): ResourceDefinition => ({
		type: 'git',
		name: repo.name,
		url: repo.url,
		branch: repo.branch,
		...(repo.specialNotes && { specialNotes: repo.specialNotes }),
		...(repo.searchPath && { searchPath: repo.searchPath })
	});

	/**
	 * Check for and migrate legacy config (btca.json) to new format
	 * Supports two legacy formats:
	 * 1. Very old: has "repos" array with git repos only
	 * 2. Intermediate: has "resources" array (already migrated repos->resources)
	 *
	 * Returns migrated config if legacy exists, null otherwise
	 */
	const migrateLegacyConfig = async (
		legacyPath: string,
		newConfigPath: string
	): Promise<StoredConfig | null> => {
		const legacyExists = await Bun.file(legacyPath).exists();
		if (!legacyExists) return null;

		Metrics.info('config.legacy.found', { path: legacyPath });

		const legacyResult = await Result.gen(async function* () {
			const content = yield* Result.await(
				Result.tryPromise({
					try: () => Bun.file(legacyPath).text(),
					catch: (cause) => ({
						stage: 'read' as const,
						cause
					})
				})
			);
			const parsed = yield* Result.try(() => JSON.parse(content)).mapError((cause) => ({
				stage: 'parse' as const,
				cause
			}));
			return Result.ok(parsed);
		});

		const parsed = legacyResult.match({
			ok: (value) => value,
			err: (error) => {
				const event =
					error.stage === 'read' ? 'config.legacy.read_failed' : 'config.legacy.parse_failed';
				Metrics.error(event, { path: legacyPath, error: String(error.cause) });
				return null;
			}
		});

		if (!parsed) return null;

		// Try the intermediate format first (has "resources" array)
		const resourcesResult = LegacyResourcesConfigSchema.safeParse(parsed);
		if (resourcesResult.success) {
			const legacy = resourcesResult.data;
			Metrics.info('config.legacy.parsed', {
				format: 'resources',
				resourceCount: legacy.resources.length,
				model: legacy.model,
				provider: legacy.provider
			});

			// Resources are already in the right format, just copy them over
			const migrated: StoredConfig = {
				$schema: CONFIG_SCHEMA_URL,
				resources: legacy.resources,
				model: legacy.model,
				provider: legacy.provider
			};

			return finalizeMigration(migrated, legacyPath, newConfigPath, legacy.resources.length);
		}

		// Try the very old format (has "repos" array)
		const reposResult = LegacyReposConfigSchema.safeParse(parsed);
		if (reposResult.success) {
			const legacy = reposResult.data;
			Metrics.info('config.legacy.parsed', {
				format: 'repos',
				repoCount: legacy.repos.length,
				model: legacy.model,
				provider: legacy.provider
			});

			// Convert legacy repos to resources
			const migratedResources = legacy.repos.map(legacyRepoToResource);

			// Merge with default resources (legacy resources take precedence by name)
			const migratedNames = new Set(migratedResources.map((r) => r.name));
			const defaultsToAdd = DEFAULT_RESOURCES.filter((r) => !migratedNames.has(r.name));
			const allResources = [...migratedResources, ...defaultsToAdd];

			const migrated: StoredConfig = {
				$schema: CONFIG_SCHEMA_URL,
				resources: allResources,
				model: legacy.model,
				provider: legacy.provider
			};

			return finalizeMigration(migrated, legacyPath, newConfigPath, migratedResources.length);
		}

		// Neither format matched
		Metrics.error('config.legacy.invalid', {
			path: legacyPath,
			error: 'Config does not match any known legacy format'
		});
		return null;
	};

	/**
	 * Write migrated config and rename legacy file
	 */
	const finalizeMigration = async (
		migrated: StoredConfig,
		legacyPath: string,
		newConfigPath: string,
		migratedCount: number
	): Promise<StoredConfig> => {
		const configDir = newConfigPath.slice(0, newConfigPath.lastIndexOf('/'));
		const result = await Result.gen(async function* () {
			yield* Result.await(
				Result.tryPromise({
					try: () => fs.mkdir(configDir, { recursive: true }),
					catch: (cause) =>
						new ConfigError({
							message: 'Failed to write migrated config',
							hint: `Check that you have write permissions to "${configDir}".`,
							cause
						})
				})
			);

			yield* Result.await(
				writeConfigFile(
					newConfigPath,
					migrated,
					'Failed to write migrated config',
					`Check that you have write permissions to "${configDir}".`
				)
			);

			return Result.ok(migrated);
		});

		if (!Result.isOk(result)) throw result.error;
		const saved = result.value;

		Metrics.info('config.legacy.migrated', {
			newPath: newConfigPath,
			resourceCount: migrated.resources.length,
			migratedCount
		});

		// Rename the legacy file to mark it as migrated
		const renameResult = await Result.tryPromise(() =>
			fs.rename(legacyPath, `${legacyPath}.migrated`)
		);
		renameResult.match({
			ok: () =>
				Metrics.info('config.legacy.renamed', { from: legacyPath, to: `${legacyPath}.migrated` }),
			err: () => Metrics.info('config.legacy.rename_skipped', { path: legacyPath })
		});

		return saved;
	};

	const loadConfigFromPath = async (configPath: string): Promise<StoredConfig> => {
		const result = await Result.gen(async function* () {
			const content = yield* Result.await(readConfigText(configPath));
			const parsed = yield* parseConfigText(configPath, content);
			const stored = yield* validateStoredConfig(parsed);
			return Result.ok(stored);
		});

		if (!Result.isOk(result)) throw result.error;
		return result.value;
	};

	const createDefaultConfig = async (configPath: string): Promise<StoredConfig> => {
		const configDir = configPath.slice(0, configPath.lastIndexOf('/'));

		const defaultStored: StoredConfig = {
			$schema: CONFIG_SCHEMA_URL,
			resources: DEFAULT_RESOURCES,
			model: DEFAULT_MODEL,
			provider: DEFAULT_PROVIDER,
			providerTimeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS
		};

		const result = await Result.gen(async function* () {
			yield* Result.await(
				Result.tryPromise({
					try: () => fs.mkdir(configDir, { recursive: true }),
					catch: (cause) =>
						new ConfigError({
							message: `Failed to create config directory: "${configDir}"`,
							hint: 'Check that you have write permissions to the parent directory.',
							cause
						})
				})
			);
			yield* Result.await(
				writeConfigFile(
					configPath,
					defaultStored,
					`Failed to write default config to: "${configPath}"`,
					'Check that you have write permissions to the config directory.'
				)
			);
			return Result.ok(defaultStored);
		});

		if (!Result.isOk(result)) throw result.error;
		return result.value;
	};

	const saveConfig = async (configPath: string, stored: StoredConfig): Promise<void> => {
		const result = await writeConfigFile(
			configPath,
			stored,
			`Failed to save config to: "${configPath}"`,
			'Check that you have write permissions and the disk is not full.'
		);
		if (!Result.isOk(result)) throw result.error;
	};

	/**
	 * Create a config service.
	 *
	 * When both global and project configs exist, mutations (add/remove resource, update model)
	 * only modify the project config. The merged view is computed on-the-fly for reads.
	 *
	 * @param globalConfig - The global config (always present)
	 * @param projectConfig - The project config (null if not using project-level config)
	 * @param resourcesDirectory - Directory for resource data
	 * @param configPath - Path to the config file to save (project if exists, else global)
	 */
	const makeService = (
		globalConfig: StoredConfig,
		projectConfig: StoredConfig | null,
		resourcesDirectory: string,
		configPath: string
	): Service => {
		// Track configs separately to avoid resource leakage
		let currentGlobalConfig = globalConfig;
		let currentProjectConfig = projectConfig;

		// Compute merged resources on-the-fly
		const getMergedResources = (): readonly ResourceDefinition[] => {
			if (!currentProjectConfig) {
				return currentGlobalConfig.resources;
			}
			// Merge: global first, then project overrides by name
			const resourceMap = new Map<string, ResourceDefinition>();
			for (const resource of currentGlobalConfig.resources) {
				resourceMap.set(resource.name, resource);
			}
			for (const resource of currentProjectConfig.resources) {
				resourceMap.set(resource.name, resource);
			}
			return Array.from(resourceMap.values());
		};

		const mergeProviderOptions = (
			globalConfigValue: StoredConfig,
			projectConfigValue: StoredConfig | null
		): ProviderOptionsMap => {
			const merged: ProviderOptionsMap = {};
			const globalOptions = globalConfigValue.providerOptions ?? {};
			const projectOptions = projectConfigValue?.providerOptions ?? {};

			for (const [providerId, options] of Object.entries(globalOptions)) {
				merged[providerId] = { ...options };
			}

			for (const [providerId, options] of Object.entries(projectOptions)) {
				merged[providerId] = { ...(merged[providerId] ?? {}), ...options };
			}

			return merged;
		};

		const getMergedProviderOptions = (): ProviderOptionsMap =>
			mergeProviderOptions(currentGlobalConfig, currentProjectConfig);

		// Get the config that should be used for model/provider
		const getActiveConfig = (): StoredConfig => {
			return currentProjectConfig ?? currentGlobalConfig;
		};

		// Get the config that should be mutated
		const getMutableConfig = (): StoredConfig => {
			return currentProjectConfig ?? currentGlobalConfig;
		};

		// Update the mutable config
		const setMutableConfig = (config: StoredConfig): void => {
			if (currentProjectConfig) {
				currentProjectConfig = config;
			} else {
				currentGlobalConfig = config;
			}
		};

		const service: Service = {
			resourcesDirectory,
			configPath,
			get resources() {
				return getMergedResources();
			},
			get model() {
				return getActiveConfig().model ?? DEFAULT_MODEL;
			},
			get provider() {
				return getActiveConfig().provider ?? DEFAULT_PROVIDER;
			},
			get providerTimeoutMs() {
				return getActiveConfig().providerTimeoutMs;
			},
			getProviderOptions: (providerId: string) => getMergedProviderOptions()[providerId],
			getResource: (name: string) => getMergedResources().find((r) => r.name === name),

			updateModel: async (
				provider: string,
				model: string,
				providerOptions?: ProviderOptionsConfig
			) => {
				if (!isProviderSupported(provider)) {
					const available = getSupportedProviders();
					throw new ConfigError({
						message: `Provider "${provider}" is not supported`,
						hint: `Available providers: ${available.join(', ')}. Open an issue to request this provider: https://github.com/davis7dotsh/better-context/issues.`
					});
				}
				const mutableConfig = getMutableConfig();
				const existingProviderOptions = mutableConfig.providerOptions ?? {};
				const nextProviderOptions = providerOptions
					? {
							...existingProviderOptions,
							[provider]: {
								...(existingProviderOptions[provider] ?? {}),
								...providerOptions
							}
						}
					: existingProviderOptions;
				const updated = {
					...mutableConfig,
					provider,
					model,
					...(providerOptions ? { providerOptions: nextProviderOptions } : {})
				};

				if (provider === 'openai-compat') {
					const merged = currentProjectConfig
						? mergeProviderOptions(currentGlobalConfig, updated)
						: mergeProviderOptions(updated, null);
					const compat = merged['openai-compat'];
					const baseURL = compat?.baseURL?.trim();
					const name = compat?.name?.trim();
					if (!baseURL || !name) {
						throw new ConfigError({
							message: 'openai-compat requires baseURL and name',
							hint: 'Run "btca connect -p openai-compat" to configure baseURL and name.'
						});
					}
				}
				setMutableConfig(updated);
				await saveConfig(configPath, updated);
				Metrics.info('config.model.updated', { provider, model });
				return {
					provider,
					model,
					savedTo: currentProjectConfig ? 'project' : 'global'
				};
			},

			addResource: async (resource: ResourceDefinition) => {
				// Check for duplicate name in merged resources
				const mergedResources = getMergedResources();
				if (mergedResources.some((r) => r.name === resource.name)) {
					throw new ConfigError({
						message: `Resource "${resource.name}" already exists`,
						hint: `Choose a different name or remove the existing resource first with "btca remove ${resource.name}".`
					});
				}

				// Add only to the mutable config (project if exists, else global)
				const mutableConfig = getMutableConfig();
				const updated = {
					...mutableConfig,
					resources: [...mutableConfig.resources, resource]
				};
				setMutableConfig(updated);
				await saveConfig(configPath, updated);
				Metrics.info('config.resource.added', { name: resource.name, type: resource.type });
				return resource;
			},

			removeResource: async (name: string) => {
				const mergedResources = getMergedResources();
				const exists = mergedResources.some((r) => r.name === name);
				if (!exists) {
					const available = mergedResources.map((r) => r.name);
					throw new ConfigError({
						message: `Resource "${name}" not found`,
						hint:
							available.length > 0
								? `Available resources: ${available.join(', ')}. ${CommonHints.LIST_RESOURCES}`
								: `No resources configured. ${CommonHints.ADD_RESOURCE}`
					});
				}

				const mutableConfig = getMutableConfig();
				const isInMutableConfig = mutableConfig.resources.some((r) => r.name === name);

				if (currentProjectConfig) {
					// We have a project config
					const isInGlobal = currentGlobalConfig.resources.some((r) => r.name === name);
					const isInProject = currentProjectConfig.resources.some((r) => r.name === name);

					if (isInProject) {
						// Resource is in project config - just remove it
						const updated = {
							...currentProjectConfig,
							resources: currentProjectConfig.resources.filter((r) => r.name !== name)
						};
						currentProjectConfig = updated;
						await saveConfig(configPath, updated);
						Metrics.info('config.resource.removed', { name, from: 'project' });
					} else if (isInGlobal) {
						// Resource is only in global config
						// User wants to remove a global resource from project context
						// We can't modify global config from project context, so throw an error
						throw new ConfigError({
							message: `Resource "${name}" is defined in the global config`,
							hint: `To remove this resource globally, edit the global config at "${expandHome(GLOBAL_CONFIG_DIR)}/${GLOBAL_CONFIG_FILENAME}" or run the command without a project config present.`
						});
					}
				} else {
					// No project config, modify global directly
					if (!isInMutableConfig) {
						// This shouldn't happen given the exists check above, but be safe
						throw new ConfigError({
							message: `Resource "${name}" not found in config`,
							hint: CommonHints.LIST_RESOURCES
						});
					}
					const updated = {
						...mutableConfig,
						resources: mutableConfig.resources.filter((r) => r.name !== name)
					};
					setMutableConfig(updated);
					await saveConfig(configPath, updated);
					Metrics.info('config.resource.removed', { name, from: 'global' });
				}
			},

			clearResources: async () => {
				// Clear the resources directory
				let clearedCount = 0;

				const resourcesResult = await Result.tryPromise(() => fs.readdir(resourcesDirectory));
				const resourcesDir = resourcesResult.match({
					ok: (value) => value,
					err: () => []
				});

				for (const item of resourcesDir) {
					const removeResult = await Result.tryPromise(() =>
						fs.rm(`${resourcesDirectory}/${item}`, { recursive: true, force: true })
					);
					const removed = removeResult.match({
						ok: () => true,
						err: () => false
					});
					if (!removed) break;
					clearedCount++;
				}

				Metrics.info('config.resources.cleared', { count: clearedCount });
				return { cleared: clearedCount };
			},

			reload: async () => {
				// Reload the config file from disk
				// configPath points to either project config (if it existed at startup) or global config
				Metrics.info('config.reload.start', { configPath });

				const configExists = await Bun.file(configPath).exists();
				if (!configExists) {
					Metrics.info('config.reload.skipped', { reason: 'file not found', configPath });
					return;
				}

				const reloaded = await loadConfigFromPath(configPath);

				// Update the appropriate config based on what we had at startup
				if (currentProjectConfig !== null) {
					currentProjectConfig = reloaded;
				} else {
					currentGlobalConfig = reloaded;
				}

				Metrics.info('config.reload.done', {
					resources: reloaded.resources.length,
					configPath
				});
			}
		};

		return service;
	};

	export const load = async (): Promise<Service> => {
		const cwd = process.cwd();
		Metrics.info('config.load.start', { cwd });

		const globalConfigPath = `${expandHome(GLOBAL_CONFIG_DIR)}/${GLOBAL_CONFIG_FILENAME}`;
		const projectConfigPath = `${cwd}/${PROJECT_CONFIG_FILENAME}`;

		// First, load or create the global config
		let globalConfig: StoredConfig;
		const globalExists = await Bun.file(globalConfigPath).exists();

		if (!globalExists) {
			// Check for legacy config to migrate
			const legacyConfigPath = `${expandHome(GLOBAL_CONFIG_DIR)}/${LEGACY_CONFIG_FILENAME}`;
			const migrated = await migrateLegacyConfig(legacyConfigPath, globalConfigPath);
			if (migrated) {
				Metrics.info('config.load.global', { source: 'migrated', path: globalConfigPath });
				globalConfig = migrated;
			} else {
				Metrics.info('config.load.global', { source: 'default', path: globalConfigPath });
				globalConfig = await createDefaultConfig(globalConfigPath);
			}
		} else {
			Metrics.info('config.load.global', { source: 'existing', path: globalConfigPath });
			globalConfig = await loadConfigFromPath(globalConfigPath);
		}

		// Now check for project config and merge if it exists
		const projectExists = await Bun.file(projectConfigPath).exists();
		if (projectExists) {
			Metrics.info('config.load.project', { source: 'project', path: projectConfigPath });
			let projectConfig = await loadConfigFromPath(projectConfigPath);

			Metrics.info('config.load.merged', {
				globalResources: globalConfig.resources.length,
				projectResources: projectConfig.resources.length
			});

			// Use project paths for data storage when project config exists
			// Pass both configs separately to avoid resource leakage on mutations
			let projectDataDir =
				projectConfig.dataDirectory ?? globalConfig.dataDirectory ?? expandHome(GLOBAL_DATA_DIR);

			// Migration: if no dataDirectory is set and legacy .btca exists, use it and update config
			if (!projectConfig.dataDirectory) {
				const legacyProjectDataDir = `${cwd}/.btca`;
				const legacyExists = (await Result.tryPromise(() => fs.stat(legacyProjectDataDir))).match({
					ok: () => true,
					err: () => false
				});
				if (legacyExists) {
					Metrics.info('config.project.legacy_data_dir', {
						path: legacyProjectDataDir,
						action: 'migrating'
					});
					projectDataDir = '.btca';
					const updatedProjectConfig = { ...projectConfig, dataDirectory: '.btca' };
					await saveConfig(projectConfigPath, updatedProjectConfig);
					projectConfig = updatedProjectConfig;
				}
			}

			const resolvedProjectDataDir = resolveDataDirectory(projectDataDir, cwd);
			return makeService(
				globalConfig,
				projectConfig,
				`${resolvedProjectDataDir}/resources`,
				projectConfigPath
			);
		}

		// No project config, use global only
		Metrics.info('config.load.source', { source: 'global', path: globalConfigPath });
		const globalDataDir = globalConfig.dataDirectory ?? expandHome(GLOBAL_DATA_DIR);
		const resolvedGlobalDataDir = resolveDataDirectory(
			globalDataDir,
			expandHome(GLOBAL_CONFIG_DIR)
		);
		return makeService(globalConfig, null, `${resolvedGlobalDataDir}/resources`, globalConfigPath);
	};
}
