import { Result } from 'better-result';
import { Command } from 'commander';
import os from 'node:os';
import path from 'node:path';
import { ensureServer } from '../server/manager.ts';
import { createClient, getConfig, getProviders, BtcaError } from '../client/index.ts';
import packageJson from '../../package.json';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : (packageJson.version ?? '0.0.0');

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.config', 'btca', 'btca.config.jsonc');
const PROJECT_CONFIG_FILENAME = 'btca.config.jsonc';
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/btca';

type NpmInfo = {
	'dist-tags'?: {
		latest?: string;
	};
	version?: string;
};

type StoredResource = {
	name?: unknown;
};

type StoredConfig = {
	model?: unknown;
	provider?: unknown;
	resources?: unknown;
};

function formatError(error: unknown): string {
	if (error instanceof BtcaError) {
		let output = `Error: ${error.message}`;
		if (error.hint) {
			output += `\n\nHint: ${error.hint}`;
		}
		return output;
	}
	return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

const stripJsonc = (content: string): string => {
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

const readConfigFromPath = async (configPath: string): Promise<StoredConfig | null> => {
	const configFile = Bun.file(configPath);
	if (!(await configFile.exists())) {
		return null;
	}

	const content = await configFile.text();
	const parsed: unknown = JSON.parse(stripJsonc(content));
	return parsed as StoredConfig;
};

const listResourceNames = (config: StoredConfig | null): string[] => {
	if (!config || !Array.isArray(config.resources)) {
		return [];
	}

	return config.resources
		.filter((resource) => {
			const candidate = resource as StoredResource;
			return candidate && typeof candidate === 'object' && typeof candidate.name === 'string';
		})
		.map((resource) => (resource as StoredResource).name as string);
};

const getConfigOrigin = (
	value: 'provider' | 'model',
	projectConfig: StoredConfig | null,
	globalConfig: StoredConfig | null
): string => {
	const hasInProject = projectConfig && typeof projectConfig[value] === 'string';
	if (hasInProject) return 'project';
	const hasInGlobal = globalConfig && typeof globalConfig[value] === 'string';
	if (hasInGlobal) return 'global';
	return 'default';
};

const compareVersions = (left: string, right: string): number => {
	const toParts = (value: string) =>
		(value.trim().replace(/^v/, '').split(/[-+]/, 1)[0] ?? '')
			.split('.')
			.map((part) => Number.parseInt(part, 10));

	const l = toParts(left);
	const r = toParts(right);
	const max = Math.max(l.length, r.length);

	for (let i = 0; i < max; i += 1) {
		const lv = Number.isNaN(l[i] ?? NaN) ? 0 : (l[i] ?? 0);
		const rv = Number.isNaN(r[i] ?? NaN) ? 0 : (r[i] ?? 0);
		if (lv > rv) return 1;
		if (lv < rv) return -1;
	}

	return 0;
};

const getLatestVersion = async (): Promise<string | null> => {
	try {
		const response = await fetch(NPM_REGISTRY_URL);
		if (!response.ok) {
			return null;
		}

		const info = (await response.json()) as NpmInfo;
		return info['dist-tags']?.latest ?? info.version ?? null;
	} catch {
		return null;
	}
};

const printResourceList = (label: string, resources: string[] | null) => {
	if (resources === null) {
		console.log(`${label}: (not found)`);
		return;
	}

	console.log(`${label}:`);
	if (resources.length === 0) {
		console.log('  (none)');
		return;
	}

	for (const resource of resources) {
		console.log(`  ${resource}`);
	}
};

export const statusCommand = new Command('status')
	.description('Show selected provider/model and config status')
	.action(async () => {
		const result = await Result.tryPromise(async () => {
			const server = await ensureServer({ quiet: true });
			const client = createClient(server.url);
			const projectPath = path.resolve(process.cwd(), PROJECT_CONFIG_FILENAME);

			try {
				const [config, providers, globalConfig, projectConfig] = await Promise.all([
					getConfig(client),
					getProviders(client),
					readConfigFromPath(GLOBAL_CONFIG_PATH),
					readConfigFromPath(projectPath)
				]);

				const connected = Array.isArray(providers.connected) ? providers.connected : [];
				const isAuthenticated = connected.includes(config.provider);
				const latestVersion = await getLatestVersion();
				const hasUpdate = latestVersion && compareVersions(VERSION, latestVersion) < 0;

				console.log('\n--- btca status ---\n');
				const modelSource = getConfigOrigin('model', projectConfig, globalConfig);
				const providerSource = getConfigOrigin('provider', projectConfig, globalConfig);
				console.log(`Selected model: ${config.model} (${modelSource})`);
				console.log(`Selected provider: ${config.provider} (${providerSource})`);
				console.log(`Selected provider authed: ${isAuthenticated ? 'yes' : 'no'}`);
				console.log('');

				printResourceList(
					'Global resources',
					globalConfig ? listResourceNames(globalConfig) : null
				);
				printResourceList(
					'Project resources',
					projectConfig ? listResourceNames(projectConfig) : null
				);

				console.log(`\nbtca version: ${VERSION}`);
				if (latestVersion) {
					console.log(`Latest version: ${latestVersion}`);
					if (hasUpdate) {
						console.log('Update available: run "bun add -g btca@latest"');
					} else {
						console.log('btca is up to date');
					}
				} else {
					console.log('Latest version: unavailable');
				}
			} finally {
				server.stop();
			}
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});
