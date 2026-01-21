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

export const getErrorTag = (error: unknown): string => {
	if (error && typeof error === 'object' && '_tag' in error) return String((error as any)._tag);
	return 'UnknownError';
};

export const getErrorMessage = (error: unknown): string => {
	if (error && typeof error === 'object' && 'message' in error)
		return String((error as any).message);
	return String(error);
};

export const getErrorHint = (error: unknown): string | undefined => {
	if (error && typeof error === 'object' && 'hint' in error) {
		const hint = (error as any).hint;
		return typeof hint === 'string' ? hint : undefined;
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
		'Verify the branch name exists in the repository. Common branches are "main", "master", or "dev".',
	CHECK_CONFIG: 'Check your btca config file for errors.',
	CHECK_PERMISSIONS:
		'Ensure you have access to the repository. Private repos require authentication.',
	RUN_AUTH:
		'Run "btca auth" (or "opencode auth") to configure provider credentials. btca uses OpenCode for AI queries.',
	LIST_RESOURCES: 'Run "btca config resources" to see available resources.',
	ADD_RESOURCE:
		'Add a resource with "btca config add-resource -t git -n <name> -u <url>" or edit your config file.'
} as const;
