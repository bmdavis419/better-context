import { Schema } from 'effect';
import { GitResourceSchema, ResourceDefinitionSchema } from '../resource/types.ts';

// Config file paths
export const CONFIG_DIRECTORY = '~/.config/btca';
export const CONFIG_FILENAME = 'btca.json';
export const DEFAULT_DATA_DIRECTORY = '~/.local/share/btca';
export const CONFIG_SCHEMA_URL = 'https://btca.dev/btca.schema.json';

// Legacy repo schema (for migration)
export const LegacyRepoSchema = Schema.Struct({
	name: Schema.String,
	url: Schema.String,
	branch: Schema.String,
	specialNotes: Schema.optional(Schema.String),
	searchPath: Schema.optional(Schema.String)
});

// Legacy config schema (for migration from old format)
export const LegacyConfigSchema = Schema.Struct({
	reposDirectory: Schema.String,
	workspacesDirectory: Schema.optional(Schema.String),
	port: Schema.Number,
	maxInstances: Schema.Number,
	repos: Schema.Array(LegacyRepoSchema),
	model: Schema.String,
	provider: Schema.String
});

// New config schema with resources instead of repos
export const StoredConfigSchema = Schema.Struct({
	$schema: Schema.optional(Schema.String), // JSON schema URL for LSP support
	dataDirectory: Schema.optional(Schema.String), // defaults to ~/.local/share/btca
	resources: Schema.Array(ResourceDefinitionSchema),
	model: Schema.String,
	provider: Schema.String
});

// Runtime config type (with resolved paths)
export interface Config {
	dataDirectory: string; // absolute path to ~/.local/share/btca
	resourcesDirectory: string; // dataDirectory/resources
	collectionsDirectory: string; // dataDirectory/collections
	configPath: string; // absolute path to config file
	resources: (typeof ResourceDefinitionSchema.Type)[];
	model: string;
	provider: string;
}

export type LegacyRepo = typeof LegacyRepoSchema.Type;
export type LegacyConfig = typeof LegacyConfigSchema.Type;
export type StoredConfig = typeof StoredConfigSchema.Type;

// Default resources (git repos)
export const DEFAULT_RESOURCES: (typeof ResourceDefinitionSchema.Type)[] = [
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

export const DEFAULT_MODEL = 'big-pickle';
export const DEFAULT_PROVIDER = 'opencode';

/**
 * Convert a legacy repo to a git resource
 */
export const legacyRepoToResource = (repo: LegacyRepo): typeof GitResourceSchema.Type => ({
	type: 'git',
	name: repo.name,
	url: repo.url,
	branch: repo.branch,
	...(repo.specialNotes && { specialNotes: repo.specialNotes }),
	...(repo.searchPath && { searchPath: repo.searchPath })
});
