import { Result } from 'better-result';

import { toWebError, type WebError } from './errors';

type ConvexResultError = WebError | Error | string;

type ConvexResultObject = { ok: boolean; error?: unknown; [key: string]: unknown };

type ConvexActionResult<T> = T extends { ok: false }
	? never
	: T extends { ok: true }
		? Omit<T, 'ok'>
		: T;

const toErrorMessage = (error: unknown): string => {
	if (typeof error === 'string') {
		return error;
	}

	if (error instanceof Error) {
		return error.message || 'Unknown error';
	}

	if (
		error &&
		typeof error === 'object' &&
		'message' in error &&
		typeof error.message === 'string'
	) {
		return error.message;
	}

	return 'Unknown error';
};

const getConvexErrorStatus = (cause: unknown): number | null => {
	if (!cause || typeof cause !== 'object') return null;

	const raw = cause as {
		code?: unknown;
		error?: unknown;
		message?: unknown;
	};

	const code = typeof raw.code === 'string' ? raw.code.toLowerCase() : '';
	if (!code) return null;

	if (code === 'unauthorized' || code === 'forbidden') return code === 'forbidden' ? 403 : 401;
	if (code === 'not_found') return 404;
	if (code === 'already_exists') return 409;
	return null;
};

export const toResult = <T>(operation: () => T) => {
	try {
		return Result.ok(operation());
	} catch (error) {
		return Result.err(toWebError(error));
	}
};

export const toResultAsync = <T>(operation: () => Promise<T>) => {
	return operation()
		.then((value) => Result.ok(value))
		.catch((error) => Result.err(toWebError(error)));
};

const isConvexResultObject = (result: unknown): result is ConvexResultObject => {
	if (!result || typeof result !== 'object') {
		return false;
	}
	return 'ok' in result;
};

const toActionSuccess = <T>(result: T): ConvexActionResult<T> => {
	const value = result as ConvexResultObject;
	if (!isConvexResultObject(result)) {
		return result as ConvexActionResult<T>;
	}

	if (value.ok !== true) {
		return undefined as unknown as ConvexActionResult<T>;
	}

	const withoutOk = { ...value } as Record<string, unknown>;
	delete withoutOk.ok;
	return withoutOk as ConvexActionResult<T>;
};

export const extractApiKey = (request: Request): string | null => {
	const authHeader = request.headers.get('Authorization');
	if (!authHeader?.startsWith('Bearer ')) {
		return null;
	}
	return authHeader.slice(7) || null;
};

export const jsonResponse = (data: unknown, status = 200): Response => {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json'
		}
	});
};

export const jsonError = (status: number, error: string): Response =>
	jsonResponse({ error }, status);

export const mapCliErrorStatus = (error: string): number => {
	const lower = error.toLowerCase();
	if (lower.includes('valid') || lower.includes('unauthorized')) return 401;
	if (lower.includes('not found')) return 404;
	if (lower.includes('forbidden')) return 403;
	if (lower.includes('already exists')) return 409;
	return 400;
};

export const runConvexActionResult = async <T>(
	action: () => Promise<T>
): Promise<Result<ConvexActionResult<T>, ConvexResultError>> => {
	const wrapped = await toResultAsync(action);
	if (Result.isError(wrapped)) {
		return Result.err(toWebError(wrapped.error));
	}

	const value = wrapped.value;
	if (isConvexResultObject(value) && value.ok === false) {
		return Result.err(toWebError(toErrorMessage(value.error ?? 'Unknown error')));
	}

	return Result.ok(toActionSuccess(wrapped.value));
};

export const runConvexQueryResult = async <T>(
	query: () => Promise<T>
): Promise<Result<ConvexActionResult<T>, ConvexResultError>> => {
	const wrapped = await toResultAsync(query);
	if (Result.isError(wrapped)) {
		return Result.err(toWebError(wrapped.error));
	}

	const value = wrapped.value;
	if (isConvexResultObject(value) && value.ok === false) {
		return Result.err(toWebError(toErrorMessage(value.error ?? 'Unknown error')));
	}

	return Result.ok(toActionSuccess(wrapped.value));
};

export const handleConvexRouteResult = <T>(
	result: Result<T, ConvexResultError>,
	options: {
		onOk: (value: T) => unknown;
		mapErrorStatus?: (error: string, cause?: unknown) => number;
	}
): Response => {
	if (Result.isError(result)) {
		const message = toErrorMessage(result.error);
		const status =
			(options.mapErrorStatus ?? mapCliErrorStatus)(message, result.error) ??
			getConvexErrorStatus(result.error) ??
			mapCliErrorStatus(message);
		return jsonError(status, message);
	}

	const body = options.onOk(result.value);
	return body instanceof Response ? body : jsonResponse(body);
};

export const toWebErrorResponse = (error: WebError, fallback = 500): Response =>
	jsonError(fallback, error.message);
