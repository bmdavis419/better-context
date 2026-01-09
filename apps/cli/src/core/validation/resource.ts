import { Effect } from 'effect';
import { ConfigError } from '../config/service.ts';
import { ResourceError } from '../resource/errors.ts';

/**
 * Resource name validation regex.
 * Must start with a letter, followed by alphanumeric characters and hyphens only.
 * Examples: "reactjs-docs", "some-name-here"
 */
const RESOURCE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9-]*$/;

/**
 * Branch name validation regex.
 * Allows alphanumeric characters, forward slashes, dots, underscores, and hyphens.
 * Must not start with a hyphen (to prevent git option injection).
 */
const BRANCH_NAME_REGEX = /^[a-zA-Z0-9/_.-]+$/;

/**
 * Provider name validation regex.
 * Allows letters, numbers, dots, underscores, plus, hyphens, forward slashes, and colons.
 * Blocks shell metacharacters and path traversal.
 * Examples: "openai", "anthropic", "meta-llama/llama-4", "google/gemini"
 */
const PROVIDER_NAME_REGEX = /^[a-zA-Z0-9._+\-/:]+$/;

/**
 * Model name validation regex.
 * Allows letters, numbers, dots, underscores, plus, hyphens, forward slashes, and colons.
 * Blocks shell metacharacters and path traversal.
 * Examples: "gpt-4.1", "claude-sonnet-4.5", "gemini-2.5-pro", "command-r+"
 */
const MODEL_NAME_REGEX = /^[a-zA-Z0-9._+\-/:]+$/;

/**
 * Validate a resource name to prevent path traversal and git injection attacks.
 *
 * Ensures:
 * - Starts with a letter (prevents git option injection with -)
 * - Only contains letters, numbers, and hyphens
 * - Examples: "reactjs-docs", "some-name-here"
 *
 * @param name - The resource name to validate
 * @returns Effect that succeeds if valid, fails with ConfigError if invalid
 */
export const validateResourceName = (name: string): Effect.Effect<void, ConfigError> => {
	// Reject empty names
	if (!name || name.trim().length === 0) {
		return Effect.fail(
			new ConfigError({
				message: 'Resource name cannot be empty.'
			})
		);
	}

	// Single regex validation - must start with letter, only letters/numbers/hyphens allowed
	if (!RESOURCE_NAME_REGEX.test(name)) {
		return Effect.fail(
			new ConfigError({
				message: `Invalid resource name: ${name}. Must start with a letter and contain only alphanumeric characters and hyphens.`
			})
		);
	}

	return Effect.void;
};

/**
 * Validate a git branch name to prevent git injection attacks.
 *
 * Ensures:
 * - Only safe characters (alphanumeric, /, ., _, -)
 * - Does not start with - or -- (prevents git option injection)
 *
 * @param branch - The branch name to validate
 * @returns Effect that succeeds if valid, fails with ResourceError if invalid
 */
export const validateBranchName = (branch: string): Effect.Effect<void, ResourceError> => {
	// Reject empty branch names
	if (!branch || branch.trim().length === 0) {
		return Effect.fail(
			new ResourceError({
				message: 'Branch name cannot be empty.'
			})
		);
	}

	// Reject names starting with hyphen (git option injection)
	if (branch.startsWith('-')) {
		return Effect.fail(
			new ResourceError({
				message: `Invalid branch name: ${branch}. Must not start with '-' to prevent git option injection.`
			})
		);
	}

	// Validate against allowed characters
	if (!BRANCH_NAME_REGEX.test(branch)) {
		return Effect.fail(
			new ResourceError({
				message: `Invalid branch name: ${branch}. Must contain only alphanumeric characters, forward slashes, dots, underscores, and hyphens.`
			})
		);
	}

	return Effect.void;
};

/**
 * Validate a git URL to prevent unsafe git operations.
 *
 * Ensures:
 * - Only HTTPS protocol (rejects file://, git://, ssh://, ext::, etc.)
 * - No embedded credentials (username:password@)
 * - No localhost or private IP addresses
 *
 * @param url - The git URL to validate
 * @returns Effect that succeeds if valid, fails with ResourceError if invalid
 */
export const validateGitUrl = (url: string): Effect.Effect<void, ResourceError> => {
	// Reject empty URLs
	if (!url || url.trim().length === 0) {
		return Effect.fail(
			new ResourceError({
				message: 'Git URL cannot be empty.'
			})
		);
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return Effect.fail(
			new ResourceError({
				message: `Invalid URL format: ${url}`
			})
		);
	}

	// Only allow HTTPS protocol
	if (parsed.protocol !== 'https:') {
		return Effect.fail(
			new ResourceError({
				message: `Invalid URL protocol: ${parsed.protocol}. Only HTTPS URLs are allowed for security reasons.`
			})
		);
	}

	// Reject embedded credentials
	if (parsed.username || parsed.password) {
		return Effect.fail(
			new ResourceError({
				message: 'URL must not contain embedded credentials. Use git credential helper instead.'
			})
		);
	}

	// Reject localhost and private IP addresses
	const hostname = parsed.hostname.toLowerCase();
	if (
		hostname === 'localhost' ||
		hostname.startsWith('127.') ||
		hostname.startsWith('192.168.') ||
		hostname.startsWith('10.') ||
		hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) || // 172.16.0.0 - 172.31.255.255
		hostname === '::1' ||
		hostname === '0.0.0.0'
	) {
		return Effect.fail(
			new ResourceError({
				message: `URL must not point to localhost or private IP addresses: ${hostname}`
			})
		);
	}

	return Effect.void;
};

/**
 * Validate a git sparse-checkout search path to prevent injection attacks.
 *
 * Ensures:
 * - No newlines (prevents multi-line pattern injection)
 * - No path traversal sequences (..)
 * - No absolute paths
 *
 * @param searchPath - The search path to validate
 * @returns Effect that succeeds if valid, fails with ResourceError if invalid
 */
export const validateSearchPath = (searchPath: string): Effect.Effect<void, ResourceError> => {
	// Empty search path is valid (means no sparse checkout)
	if (!searchPath || searchPath.trim().length === 0) {
		return Effect.void;
	}

	// Reject newlines (pattern injection)
	if (searchPath.includes('\n') || searchPath.includes('\r')) {
		return Effect.fail(
			new ResourceError({
				message: `Invalid search path: ${searchPath}. Must not contain newline characters.`
			})
		);
	}

	// Reject path traversal sequences
	if (searchPath.includes('..')) {
		return Effect.fail(
			new ResourceError({
				message: `Invalid search path: ${searchPath}. Must not contain path traversal sequences (..).`
			})
		);
	}

	// Reject absolute paths
	if (searchPath.startsWith('/') || searchPath.match(/^[a-zA-Z]:\\/)) {
		return Effect.fail(
			new ResourceError({
				message: `Invalid search path: ${searchPath}. Must not be an absolute path.`
			})
		);
	}

	return Effect.void;
};

/**
 * Validate resource notes field to prevent XSS and excessive content.
 *
 * Ensures:
 * - Reasonable length limit
 * - No control characters that could break logging
 *
 * @param notes - The notes text to validate
 * @returns Effect that succeeds if valid, fails with ConfigError if invalid
 */
export const validateResourceNotes = (notes: string): Effect.Effect<void, ConfigError> => {
	// Empty notes are valid
	if (!notes || notes.trim().length === 0) {
		return Effect.void;
	}

	// Max length
	const MAX_NOTES_LENGTH = 500;
	if (notes.length > MAX_NOTES_LENGTH) {
		return Effect.fail(
			new ConfigError({
				message: `Notes too long: ${notes.length} characters. Maximum allowed: ${MAX_NOTES_LENGTH}.`
			})
		);
	}

	// Reject control characters except newlines and tabs
	// eslint-disable-next-line no-control-regex
	const hasInvalidControlChars = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/.test(notes);
	if (hasInvalidControlChars) {
		return Effect.fail(
			new ConfigError({
				message: 'Notes contain invalid control characters.'
			})
		);
	}

	return Effect.void;
};

/**
 * Validate provider name to prevent injection and config corruption.
 *
 * Ensures:
 * - Only safe characters allowed
 * - Reasonable length limit
 *
 * Examples: "openai", "anthropic", "meta-llama/llama-4", "google/gemini"
 *
 * @param name - The provider name to validate
 * @returns Effect that succeeds if valid, fails with ConfigError if invalid
 */
export const validateProviderName = (name: string): Effect.Effect<void, ConfigError> => {
	if (!name || name.trim().length === 0) {
		return Effect.fail(
			new ConfigError({
				message: 'Provider name cannot be empty.'
			})
		);
	}

	const MAX_NAME_LENGTH = 100;
	if (name.length > MAX_NAME_LENGTH) {
		return Effect.fail(
			new ConfigError({
				message: `Provider name too long: ${name.length} characters. Maximum allowed: ${MAX_NAME_LENGTH}.`
			})
		);
	}

	// Validate against regex (defined at top of file)
	if (!PROVIDER_NAME_REGEX.test(name)) {
		return Effect.fail(
			new ConfigError({
				message: `Invalid provider name: ${name}. Must contain only letters, numbers, and these characters: . _ + - / :`
			})
		);
	}

	return Effect.void;
};

/**
 * Validate model name to prevent injection and config corruption.
 *
 * Ensures:
 * - Only safe characters allowed
 * - Reasonable length limit
 *
 * Examples: "gpt-4.1", "claude-sonnet-4.5", "gemini-2.5-pro", "command-r+"
 *
 * @param name - The model name to validate
 * @returns Effect that succeeds if valid, fails with ConfigError if invalid
 */
export const validateModelName = (name: string): Effect.Effect<void, ConfigError> => {
	if (!name || name.trim().length === 0) {
		return Effect.fail(
			new ConfigError({
				message: 'Model name cannot be empty.'
			})
		);
	}

	const MAX_NAME_LENGTH = 100;
	if (name.length > MAX_NAME_LENGTH) {
		return Effect.fail(
			new ConfigError({
				message: `Model name too long: ${name.length} characters. Maximum allowed: ${MAX_NAME_LENGTH}.`
			})
		);
	}

	// Validate against regex (defined at top of file)
	if (!MODEL_NAME_REGEX.test(name)) {
		return Effect.fail(
			new ConfigError({
				message: `Invalid model name: ${name}. Must contain only letters, numbers, and these characters: . _ + - / :`
			})
		);
	}

	return Effect.void;
};
