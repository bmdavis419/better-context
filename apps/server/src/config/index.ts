import { promises as fs } from 'node:fs';

import { z } from 'zod';
import { Metrics } from '../metrics/index.ts';
import { ResourceDefinitionSchema, type ResourceDefinition } from '../resources/schema.ts';

export const GLOBAL_CONFIG_DIR = '~/.config/btca';
export const GLOBAL_CONFIG_FILENAME = 'btca.config.jsonc';
export const GLOBAL_DATA_DIR = '~/.local/share/btca';
export const PROJECT_CONFIG_FILENAME = 'btca.config.jsonc';
export const PROJECT_DATA_DIR = '.btca';
export const CONFIG_SCHEMA_URL = 'https://btca.dev/btca.schema.json';

export const DEFAULT_MODEL = 'claude-haiku-4-5';
export const DEFAULT_PROVIDER = 'opencode';

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

const StoredConfigSchema = z.object({
	$schema: z.string().optional(),
	resources: z.array(ResourceDefinitionSchema),
	model: z.string(),
	provider: z.string()
});

type StoredConfig = z.infer<typeof StoredConfigSchema>;

export namespace Config {
	export class ConfigError extends Error {
		readonly _tag = 'ConfigError';
		override readonly cause?: unknown;

		constructor(args: { message: string; cause?: unknown }) {
			super(args.message);
			this.cause = args.cause;
		}
	}

	export type Service = {
		resourcesDirectory: string;
		collectionsDirectory: string;
		resources: readonly ResourceDefinition[];
		model: string;
		provider: string;
		getResource: (name: string) => ResourceDefinition | undefined;
	};

	const expandHome = (path: string): string => {
		const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
		if (path.startsWith('~/')) return home + path.slice(1);
		return path;
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

	const loadConfigFromPath = async (configPath: string): Promise<StoredConfig> => {
		let content: string;
		try {
			content = await Bun.file(configPath).text();
		} catch (cause) {
			throw new ConfigError({ message: 'Failed to read config', cause });
		}

		let parsed: unknown;
		try {
			parsed = parseJsonc(content);
		} catch (cause) {
			throw new ConfigError({ message: 'Failed to parse config JSONC', cause });
		}

		const result = StoredConfigSchema.safeParse(parsed);
		if (!result.success) {
			throw new ConfigError({ message: 'Invalid config', cause: result.error });
		}
		return result.data;
	};

	const createDefaultConfig = async (configPath: string): Promise<StoredConfig> => {
		const configDir = configPath.slice(0, configPath.lastIndexOf('/'));
		try {
			await fs.mkdir(configDir, { recursive: true });
		} catch (cause) {
			throw new ConfigError({ message: 'Failed to create config directory', cause });
		}

		const defaultStored: StoredConfig = {
			$schema: CONFIG_SCHEMA_URL,
			resources: DEFAULT_RESOURCES,
			model: DEFAULT_MODEL,
			provider: DEFAULT_PROVIDER
		};

		try {
			await Bun.write(configPath, JSON.stringify(defaultStored, null, 2));
		} catch (cause) {
			throw new ConfigError({ message: 'Failed to write default config', cause });
		}

		return defaultStored;
	};

	const makeService = (
		stored: StoredConfig,
		resourcesDirectory: string,
		collectionsDirectory: string
	): Service => ({
		resourcesDirectory,
		collectionsDirectory,
		resources: stored.resources,
		model: stored.model,
		provider: stored.provider,
		getResource: (name: string) => stored.resources.find((r) => r.name === name)
	});

	export const load = async (): Promise<Service> => {
		const cwd = process.cwd();
		Metrics.info('config.load.start', { cwd });

		const projectConfigPath = `${cwd}/${PROJECT_CONFIG_FILENAME}`;
		if (await Bun.file(projectConfigPath).exists()) {
			Metrics.info('config.load.source', { source: 'project', path: projectConfigPath });
			const stored = await loadConfigFromPath(projectConfigPath);
			return makeService(
				stored,
				`${cwd}/${PROJECT_DATA_DIR}/resources`,
				`${cwd}/${PROJECT_DATA_DIR}/collections`
			);
		}

		const globalConfigPath = `${expandHome(GLOBAL_CONFIG_DIR)}/${GLOBAL_CONFIG_FILENAME}`;
		const globalExists = await Bun.file(globalConfigPath).exists();
		Metrics.info('config.load.source', {
			source: globalExists ? 'global' : 'default',
			path: globalConfigPath
		});

		const stored = globalExists
			? await loadConfigFromPath(globalConfigPath)
			: await createDefaultConfig(globalConfigPath);

		return makeService(
			stored,
			`${expandHome(GLOBAL_DATA_DIR)}/resources`,
			`${expandHome(GLOBAL_DATA_DIR)}/collections`
		);
	};
}
