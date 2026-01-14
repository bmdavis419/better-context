/**
 * Input validation utilities for the btca server.
 *
 * These validators prevent security issues including:
 * - Path traversal attacks via resource names
 * - Git injection via malicious URLs
 * - Command injection via branch names
 * - DoS via unbounded input sizes
 */

// ─────────────────────────────────────────────────────────────────────────────
// Regex Patterns
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resource name: must start with a letter, followed by alphanumeric and hyphens only.
 * This prevents path traversal (../), git option injection (-), and shell metacharacters.
 */
const RESOURCE_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9-]*$/;

/**
 * Branch name: alphanumeric, forward slashes, dots, underscores, and hyphens.
 * Must not start with hyphen to prevent git option injection.
 */
const BRANCH_NAME_REGEX = /^[a-zA-Z0-9/_.-]+$/;

/**
 * Provider/Model names: letters, numbers, dots, underscores, plus, hyphens, forward slashes, colons.
 * Blocks shell metacharacters and path traversal.
 */
const SAFE_NAME_REGEX = /^[a-zA-Z0-9._+\-/:]+$/;

// ─────────────────────────────────────────────────────────────────────────────
// Limits
// ─────────────────────────────────────────────────────────────────────────────

export const LIMITS = {
	/** Maximum length for resource names */
	RESOURCE_NAME_MAX: 64,
	/** Maximum length for branch names */
	BRANCH_NAME_MAX: 128,
	/** Maximum length for provider names */
	PROVIDER_NAME_MAX: 100,
	/** Maximum length for model names */
	MODEL_NAME_MAX: 100,
	/** Maximum length for special notes */
	NOTES_MAX: 500,
	/** Maximum length for search paths */
	SEARCH_PATH_MAX: 256,
	/** Maximum length for questions (includes conversation history when formatted) */
	QUESTION_MAX: 100_000,
	/** Maximum number of resources per request */
	MAX_RESOURCES_PER_REQUEST: 20
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Validation Result Type
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationResult = { valid: true } | { valid: false; error: string };

const ok = (): ValidationResult => ({ valid: true });
const fail = (error: string): ValidationResult => ({ valid: false, error });

// ─────────────────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a resource name to prevent path traversal and git injection attacks.
 *
 * Requirements:
 * - Non-empty
 * - Starts with a letter (prevents git option injection with -)
 * - Only contains letters, numbers, and hyphens
 * - Max length enforced
 */
export const validateResourceName = (name: string): ValidationResult => {
	if (!name || name.trim().length === 0) {
		return fail('Resource name cannot be empty');
	}

	if (name.length > LIMITS.RESOURCE_NAME_MAX) {
		return fail(`Resource name too long: ${name.length} chars (max ${LIMITS.RESOURCE_NAME_MAX})`);
	}

	if (!RESOURCE_NAME_REGEX.test(name)) {
		return fail(
			`Invalid resource name: "${name}". Must start with a letter and contain only alphanumeric characters and hyphens`
		);
	}

	return ok();
};

/**
 * Validate a git branch name to prevent git injection attacks.
 *
 * Requirements:
 * - Non-empty
 * - Does not start with hyphen (prevents git option injection)
 * - Only safe characters
 * - Max length enforced
 */
export const validateBranchName = (branch: string): ValidationResult => {
	if (!branch || branch.trim().length === 0) {
		return fail('Branch name cannot be empty');
	}

	if (branch.length > LIMITS.BRANCH_NAME_MAX) {
		return fail(`Branch name too long: ${branch.length} chars (max ${LIMITS.BRANCH_NAME_MAX})`);
	}

	if (branch.startsWith('-')) {
		return fail(
			`Invalid branch name: "${branch}". Must not start with '-' to prevent git option injection`
		);
	}

	if (!BRANCH_NAME_REGEX.test(branch)) {
		return fail(
			`Invalid branch name: "${branch}". Must contain only alphanumeric characters, forward slashes, dots, underscores, and hyphens`
		);
	}

	return ok();
};

/**
 * Validate a git URL to prevent unsafe git operations.
 *
 * Requirements:
 * - Valid URL format
 * - HTTPS protocol only (rejects file://, git://, ssh://, ext::, etc.)
 * - No embedded credentials
 * - No localhost or private IP addresses
 */
export const validateGitUrl = (url: string): ValidationResult => {
	if (!url || url.trim().length === 0) {
		return fail('Git URL cannot be empty');
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return fail(`Invalid URL format: "${url}"`);
	}

	// Only allow HTTPS protocol
	if (parsed.protocol !== 'https:') {
		return fail(
			`Invalid URL protocol: ${parsed.protocol}. Only HTTPS URLs are allowed for security reasons`
		);
	}

	// Reject embedded credentials
	if (parsed.username || parsed.password) {
		return fail('URL must not contain embedded credentials');
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
		return fail(`URL must not point to localhost or private IP addresses: ${hostname}`);
	}

	return ok();
};

/**
 * Validate a git sparse-checkout search path to prevent injection attacks.
 *
 * Requirements:
 * - No newlines (prevents multi-line pattern injection)
 * - No path traversal sequences (..)
 * - No absolute paths
 * - Max length enforced
 */
export const validateSearchPath = (searchPath: string | undefined): ValidationResult => {
	// Empty/undefined search path is valid (means no sparse checkout)
	if (!searchPath || searchPath.trim().length === 0) {
		return ok();
	}

	if (searchPath.length > LIMITS.SEARCH_PATH_MAX) {
		return fail(`Search path too long: ${searchPath.length} chars (max ${LIMITS.SEARCH_PATH_MAX})`);
	}

	// Reject newlines (pattern injection)
	if (searchPath.includes('\n') || searchPath.includes('\r')) {
		return fail('Search path must not contain newline characters');
	}

	// Reject path traversal sequences
	if (searchPath.includes('..')) {
		return fail('Search path must not contain path traversal sequences (..)');
	}

	// Reject absolute paths
	if (searchPath.startsWith('/') || searchPath.match(/^[a-zA-Z]:\\/)) {
		return fail('Search path must not be an absolute path');
	}

	return ok();
};

/**
 * Validate a local file path.
 *
 * Requirements:
 * - Non-empty
 * - No null bytes
 * - Must be absolute path
 */
export const validateLocalPath = (path: string): ValidationResult => {
	if (!path || path.trim().length === 0) {
		return fail('Local path cannot be empty');
	}

	// Reject null bytes
	if (path.includes('\0')) {
		return fail('Path must not contain null bytes');
	}

	// Must be absolute path (starts with / on Unix or drive letter on Windows)
	if (!path.startsWith('/') && !path.match(/^[a-zA-Z]:\\/)) {
		return fail('Local path must be an absolute path');
	}

	return ok();
};

/**
 * Validate resource notes to prevent excessive content.
 *
 * Requirements:
 * - Max length enforced
 * - No control characters (except newlines and tabs)
 */
export const validateNotes = (notes: string | undefined): ValidationResult => {
	if (!notes || notes.trim().length === 0) {
		return ok();
	}

	if (notes.length > LIMITS.NOTES_MAX) {
		return fail(`Notes too long: ${notes.length} chars (max ${LIMITS.NOTES_MAX})`);
	}

	// Reject control characters except newlines and tabs
	// eslint-disable-next-line no-control-regex
	const hasInvalidControlChars = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/.test(notes);
	if (hasInvalidControlChars) {
		return fail('Notes contain invalid control characters');
	}

	return ok();
};

/**
 * Validate provider name.
 */
export const validateProviderName = (name: string): ValidationResult => {
	if (!name || name.trim().length === 0) {
		return fail('Provider name cannot be empty');
	}

	if (name.length > LIMITS.PROVIDER_NAME_MAX) {
		return fail(`Provider name too long: ${name.length} chars (max ${LIMITS.PROVIDER_NAME_MAX})`);
	}

	if (!SAFE_NAME_REGEX.test(name)) {
		return fail(
			`Invalid provider name: "${name}". Must contain only letters, numbers, and: . _ + - / :`
		);
	}

	return ok();
};

/**
 * Validate model name.
 */
export const validateModelName = (name: string): ValidationResult => {
	if (!name || name.trim().length === 0) {
		return fail('Model name cannot be empty');
	}

	if (name.length > LIMITS.MODEL_NAME_MAX) {
		return fail(`Model name too long: ${name.length} chars (max ${LIMITS.MODEL_NAME_MAX})`);
	}

	if (!SAFE_NAME_REGEX.test(name)) {
		return fail(
			`Invalid model name: "${name}". Must contain only letters, numbers, and: . _ + - / :`
		);
	}

	return ok();
};

/**
 * Validate question text for the /question endpoint.
 */
export const validateQuestion = (question: string): ValidationResult => {
	if (!question || question.trim().length === 0) {
		return fail('Question cannot be empty');
	}

	if (question.length > LIMITS.QUESTION_MAX) {
		return fail(`Question too long: ${question.length} chars (max ${LIMITS.QUESTION_MAX})`);
	}

	return ok();
};

/**
 * Validate resources array size.
 */
export const validateResourcesArray = (resources: string[] | undefined): ValidationResult => {
	if (!resources) {
		return ok();
	}

	if (resources.length > LIMITS.MAX_RESOURCES_PER_REQUEST) {
		return fail(
			`Too many resources: ${resources.length} (max ${LIMITS.MAX_RESOURCES_PER_REQUEST})`
		);
	}

	// Validate each resource name
	for (const name of resources) {
		const result = validateResourceName(name);
		if (!result.valid) {
			return result;
		}
	}

	return ok();
};

// ─────────────────────────────────────────────────────────────────────────────
// Composite Validators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a complete git resource definition.
 */
export const validateGitResource = (resource: {
	name: string;
	url: string;
	branch: string;
	searchPath?: string;
	specialNotes?: string;
}): ValidationResult => {
	const nameResult = validateResourceName(resource.name);
	if (!nameResult.valid) return nameResult;

	const urlResult = validateGitUrl(resource.url);
	if (!urlResult.valid) return urlResult;

	const branchResult = validateBranchName(resource.branch);
	if (!branchResult.valid) return branchResult;

	const searchPathResult = validateSearchPath(resource.searchPath);
	if (!searchPathResult.valid) return searchPathResult;

	const notesResult = validateNotes(resource.specialNotes);
	if (!notesResult.valid) return notesResult;

	return ok();
};

/**
 * Validate a complete local resource definition.
 */
export const validateLocalResource = (resource: {
	name: string;
	path: string;
	specialNotes?: string;
}): ValidationResult => {
	const nameResult = validateResourceName(resource.name);
	if (!nameResult.valid) return nameResult;

	const pathResult = validateLocalPath(resource.path);
	if (!pathResult.valid) return pathResult;

	const notesResult = validateNotes(resource.specialNotes);
	if (!notesResult.valid) return notesResult;

	return ok();
};

/**
 * Validate a question request.
 */
export const validateQuestionRequest = (request: {
	question: string;
	resources?: string[];
}): ValidationResult => {
	const questionResult = validateQuestion(request.question);
	if (!questionResult.valid) return questionResult;

	const resourcesResult = validateResourcesArray(request.resources);
	if (!resourcesResult.valid) return resourcesResult;

	return ok();
};

/**
 * Validate model update request.
 */
export const validateModelUpdate = (request: {
	provider: string;
	model: string;
}): ValidationResult => {
	const providerResult = validateProviderName(request.provider);
	if (!providerResult.valid) return providerResult;

	const modelResult = validateModelName(request.model);
	if (!modelResult.valid) return modelResult;

	return ok();
};
