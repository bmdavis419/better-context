import { Result } from 'better-result';
import { z } from 'zod';

import { LIMITS } from '../validation/index.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Validation Patterns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resource name: must start with a letter, followed by alphanumeric and hyphens only.
 * Prevents path traversal, git option injection, and shell metacharacters.
 */
const RESOURCE_NAME_REGEX = /^@?[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/;

/**
 * Branch name: alphanumeric, forward slashes, dots, underscores, and hyphens.
 * Must not start with hyphen to prevent git option injection.
 */
const BRANCH_NAME_REGEX = /^[a-zA-Z0-9/_.-]+$/;

const parseUrl = (value: string) =>
	Result.try(() => new URL(value)).match({
		ok: (url) => url,
		err: () => null
	});

// ─────────────────────────────────────────────────────────────────────────────
// Field Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resource name field with security validation.
 */
const ResourceNameSchema = z
	.string()
	.min(1, 'Resource name cannot be empty')
	.max(LIMITS.RESOURCE_NAME_MAX, `Resource name too long (max ${LIMITS.RESOURCE_NAME_MAX} chars)`)
	.regex(
		RESOURCE_NAME_REGEX,
		'Resource name must start with a letter or @ and contain only letters, numbers, ., _, -, and /'
	)
	.refine((name) => !name.includes('..'), {
		message: 'Resource name must not contain ".."'
	})
	.refine((name) => !name.includes('//'), {
		message: 'Resource name must not contain "//"'
	})
	.refine((name) => !name.endsWith('/'), {
		message: 'Resource name must not end with "/"'
	});

/**
 * Git URL field with security validation.
 * Only allows HTTPS URLs, no credentials, no private IPs.
 */
const GitUrlSchema = z
	.string()
	.min(1, 'Git URL cannot be empty')
	.refine(
		(url) => {
			const parsed = parseUrl(url);
			return parsed ? parsed.protocol === 'https:' : false;
		},
		{ message: 'Git URL must be a valid HTTPS URL' }
	)
	.refine(
		(url) => {
			const parsed = parseUrl(url);
			if (!parsed) return true;
			return !parsed.username && !parsed.password;
		},
		{ message: 'Git URL must not contain embedded credentials' }
	)
	.refine(
		(url) => {
			const parsed = parseUrl(url);
			if (!parsed) return true;
			const hostname = parsed.hostname.toLowerCase();
			return !(
				hostname === 'localhost' ||
				hostname.startsWith('127.') ||
				hostname.startsWith('192.168.') ||
				hostname.startsWith('10.') ||
				hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
				hostname === '::1' ||
				hostname === '0.0.0.0'
			);
		},
		{ message: 'Git URL must not point to localhost or private IP addresses' }
	);

/**
 * Branch name field with security validation.
 */
const BranchNameSchema = z
	.string()
	.min(1, 'Branch name cannot be empty')
	.max(LIMITS.BRANCH_NAME_MAX, `Branch name too long (max ${LIMITS.BRANCH_NAME_MAX} chars)`)
	.regex(
		BRANCH_NAME_REGEX,
		'Branch name must contain only alphanumeric characters, forward slashes, dots, underscores, and hyphens'
	)
	.refine((branch) => !branch.startsWith('-'), {
		message: "Branch name must not start with '-' to prevent git option injection"
	});

/**
 * Search path field with security validation.
 */
const SearchPathSchema = z
	.string()
	.max(LIMITS.SEARCH_PATH_MAX, `Search path too long (max ${LIMITS.SEARCH_PATH_MAX} chars)`)
	.refine((path) => !path.includes('\n') && !path.includes('\r'), {
		message: 'Search path must not contain newline characters'
	})
	.refine((path) => !path.includes('..'), {
		message: 'Search path must not contain path traversal sequences (..)'
	})
	.refine((path) => !path.startsWith('/') && !path.match(/^[a-zA-Z]:\\/), {
		message: 'Search path must not be an absolute path'
	});

const OptionalSearchPathSchema = SearchPathSchema.optional();

const SearchPathsSchema = z
	.array(SearchPathSchema)
	.refine((paths) => paths.length > 0, { message: 'searchPaths must include at least one path' })
	.optional();

/**
 * Local path field with basic validation.
 */
const LocalPathSchema = z
	.string()
	.min(1, 'Local path cannot be empty')
	.refine((path) => !path.includes('\0'), {
		message: 'Path must not contain null bytes'
	})
	.refine((path) => path.startsWith('/') || path.match(/^[a-zA-Z]:\\/), {
		message: 'Local path must be an absolute path'
	});

/**
 * Special notes field with length and content validation.
 */
const SpecialNotesSchema = z
	.string()
	.max(LIMITS.NOTES_MAX, `Notes too long (max ${LIMITS.NOTES_MAX} chars)`)
	.refine(
		// eslint-disable-next-line no-control-regex
		(notes) => !/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/.test(notes),
		{ message: 'Notes contain invalid control characters' }
	)
	.optional();

// ─────────────────────────────────────────────────────────────────────────────
// Resource Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const GitResourceSchema = z.object({
	type: z.literal('git'),
	name: ResourceNameSchema,
	url: GitUrlSchema,
	branch: BranchNameSchema,
	searchPath: OptionalSearchPathSchema,
	searchPaths: SearchPathsSchema,
	specialNotes: SpecialNotesSchema
});

export const LocalResourceSchema = z.object({
	type: z.literal('local'),
	name: ResourceNameSchema,
	path: LocalPathSchema,
	specialNotes: SpecialNotesSchema
});

export const ResourceDefinitionSchema = z.discriminatedUnion('type', [
	GitResourceSchema,
	LocalResourceSchema
]);

export type GitResource = z.infer<typeof GitResourceSchema>;
export type LocalResource = z.infer<typeof LocalResourceSchema>;
export type ResourceDefinition = z.infer<typeof ResourceDefinitionSchema>;

export const isGitResource = (value: ResourceDefinition): value is GitResource =>
	value.type === 'git';

export const isLocalResource = (value: ResourceDefinition): value is LocalResource =>
	value.type === 'local';
