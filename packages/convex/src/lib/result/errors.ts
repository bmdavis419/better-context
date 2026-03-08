import { TaggedError } from 'better-result';

export class WebValidationError extends TaggedError('WebValidationError')<{
	message: string;
	field?: string;
}>() {}

export class WebConfigMissingError extends TaggedError('WebConfigMissingError')<{
	message: string;
	config?: string;
}>() {}

export class WebExternalDependencyError extends TaggedError('WebExternalDependencyError')<{
	message: string;
	dependency: string;
}>() {}

export class WebAuthError extends TaggedError('WebAuthError')<{
	message: string;
	code?: string;
}>() {}

export class WebConflictError extends TaggedError('WebConflictError')<{
	message: string;
	conflict?: string;
}>() {}

export class WebUnhandledError extends TaggedError('WebUnhandledError')<{
	message: string;
	cause?: unknown;
}>() {}

export type WebError =
	| WebValidationError
	| WebConfigMissingError
	| WebExternalDependencyError
	| WebAuthError
	| WebConflictError
	| WebUnhandledError;

export const toWebError = (cause: unknown): WebError => {
	if (cause instanceof WebValidationError) return cause;
	if (cause instanceof WebConfigMissingError) return cause;
	if (cause instanceof WebExternalDependencyError) return cause;
	if (cause instanceof WebAuthError) return cause;
	if (cause instanceof WebConflictError) return cause;
	if (cause instanceof WebUnhandledError) return cause;

	if (cause instanceof Error) {
		return new WebUnhandledError({
			message: cause.message,
			cause
		});
	}

	return new WebUnhandledError({
		message: String(cause)
	});
};
