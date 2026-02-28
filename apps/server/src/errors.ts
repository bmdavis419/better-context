/**
 * Error utilities for btca server.
 *
 * All tagged errors support optional hints that provide actionable suggestions
 * to help users resolve issues.
 */

export type TaggedErrorLike = {
	readonly _tag: string;
	readonly message: string;
	readonly hint?: string;
};

const MAX_CAUSE_DEPTH = 12;
const WRAPPER_TAGS = new Set(['Panic', 'UnhandledException']);
const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const readStringField = (value: unknown, field: '_tag' | 'message' | 'hint') => {
	if (!isObjectRecord(value) || !(field in value)) return undefined;
	const candidate = value[field];
	return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
};

const readCauseField = (value: unknown) => {
	if (!isObjectRecord(value) || !('cause' in value)) return undefined;
	return value.cause;
};

const isWrapperMessage = (message?: string) =>
	Boolean(
		message &&
		(message.startsWith('Unhandled exception:') ||
			/handler threw$/u.test(message) ||
			/callback threw$/u.test(message))
	);

const normalizeMessage = (message: string) => {
	if (!message.startsWith('Unhandled exception:')) return message;
	const stripped = message.slice('Unhandled exception:'.length).trim();
	return stripped.length > 0 ? stripped : message;
};

const fallbackWrapperMessage = (message: string) => {
	if (
		message === 'match err handler threw' ||
		message === 'match ok handler threw' ||
		/handler threw$/u.test(message) ||
		/callback threw$/u.test(message)
	) {
		return 'Internal error while processing a result. Check logs for details.';
	}
	return normalizeMessage(message);
};

const isWrapperEntry = (entry: unknown) => {
	const tag = readStringField(entry, '_tag');
	const message = readStringField(entry, 'message');
	const hasCause = readCauseField(entry) !== undefined;
	const isAgentWrapper =
		tag === 'AgentError' && message === 'Failed to get response from AI' && hasCause;
	return (
		isAgentWrapper || (tag !== undefined && WRAPPER_TAGS.has(tag)) || isWrapperMessage(message)
	);
};

const getErrorChain = (error: unknown) => {
	const chain: unknown[] = [];
	const visited = new Set<unknown>();
	let current: unknown = error;
	let depth = 0;

	while (current !== undefined && depth < MAX_CAUSE_DEPTH && !visited.has(current)) {
		chain.push(current);
		visited.add(current);
		const cause = readCauseField(current);
		if (cause === undefined) break;
		current = cause;
		depth += 1;
	}

	return chain;
};

export const getErrorTag = (error: unknown): string => {
	const chain = getErrorChain(error);

	for (const entry of chain) {
		const tag = readStringField(entry, '_tag');
		if (tag && !isWrapperEntry(entry)) return tag;
	}

	for (const entry of chain) {
		const tag = readStringField(entry, '_tag');
		if (tag) return tag;
	}

	return 'UnknownError';
};

export const getErrorMessage = (error: unknown): string => {
	const chain = getErrorChain(error);

	for (const entry of chain) {
		const message = readStringField(entry, 'message');
		if (message && !isWrapperEntry(entry)) return message;
	}

	for (const entry of chain) {
		const message = readStringField(entry, 'message');
		if (message && !isWrapperMessage(message)) return message;
	}

	for (const entry of chain) {
		const message = readStringField(entry, 'message');
		if (message) return fallbackWrapperMessage(message);
	}

	return String(error);
};

export const getErrorHint = (error: unknown): string | undefined => {
	const chain = getErrorChain(error);

	for (const entry of chain) {
		const hint = readStringField(entry, 'hint');
		if (hint && !isWrapperEntry(entry)) return hint;
	}

	for (const entry of chain) {
		const hint = readStringField(entry, 'hint');
		if (hint) return hint;
	}

	return undefined;
};

/**
 * Format an error for display, including hint if available.
 */
export const formatErrorForDisplay = (error: unknown): string => {
	const message = getErrorMessage(error);
	const hint = getErrorHint(error);

	if (hint) {
		return `${message}\n\nHint: ${hint}`;
	}
	return message;
};

/**
 * Base options for creating tagged errors with hints.
 */
export interface TaggedErrorOptions {
	message: string;
	cause?: unknown;
	hint?: string;
	stack?: string;
}

/**
 * Common hints that can be reused across error types.
 */
export const CommonHints = {
	CLEAR_CACHE: 'Try running "btca clear" to reset cached resources and try again.',
	CHECK_NETWORK: 'Check your internet connection and try again.',
	CHECK_URL: 'Verify the URL is correct and the repository exists.',
	CHECK_BRANCH:
		'Verify the branch name exists in the repository. Common branches are "main", "master", "trunk", or "dev".',
	CHECK_CONFIG: 'Check your btca config file for errors.',
	CHECK_PERMISSIONS:
		'Ensure you have access to the repository. Private repos require authentication.',
	RUN_AUTH:
		'Run "opencode auth" in your opencode instance to configure provider credentials. btca uses opencode for AI queries.',
	LIST_RESOURCES: 'Run "btca resources" to see available resources.',
	ADD_RESOURCE: 'Add a resource with "btca add <url>" or edit your config file.'
} as const;
