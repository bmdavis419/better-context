import { Effect } from 'effect';

export type Client = {
	baseUrl: string;
};

export type ConfigResponse = {
	provider: string;
	model: string;
	providerTimeoutMs: number | null;
	maxSteps: number;
	resourcesDirectory: string;
	resourceCount: number;
};

export type ResourceRecord =
	| {
			type: 'git';
			name: string;
			url: string;
			branch: string;
			searchPath?: string | null;
			searchPaths?: string[] | null;
			specialNotes?: string | null;
	  }
	| {
			type: 'local';
			name: string;
			path: string;
			specialNotes?: string | null;
	  }
	| {
			type: 'npm';
			name: string;
			package: string;
			version?: string | null;
			specialNotes?: string | null;
	  };

export type ResourcesResponse = {
	resources: ResourceRecord[];
};

export type ProvidersResponse = {
	all: Array<{ id: string; models: Record<string, unknown> }>;
	connected: string[];
};

/**
 * Custom error class that carries hints from the server.
 */
export class BtcaError extends Error {
	readonly hint?: string;
	readonly tag?: string;

	constructor(message: string, options?: { hint?: string; tag?: string }) {
		super(message);
		this.name = 'BtcaError';
		this.hint = options?.hint;
		this.tag = options?.tag;
	}
}

/**
 * Parse error response from server and create a BtcaError.
 */
const parseErrorResponse = (
	res: Response,
	fallbackMessage: string
): Effect.Effect<BtcaError, never> => {
	const normalizeMessage = (message: string) => {
		if (message.startsWith('Unhandled exception:')) {
			const stripped = message.slice('Unhandled exception:'.length).trim();
			if (stripped.length > 0) return stripped;
		}
		if (message === 'match err handler threw' || message === 'match ok handler threw') {
			return 'Internal error while processing a result. Check the server logs for details.';
		}
		return message;
	};

	return Effect.match(
		Effect.tryPromise({
			try: () => res.json() as Promise<unknown>,
			catch: () => null
		}),
		{
			onFailure: () => new BtcaError(fallbackMessage),
			onSuccess: (body) => {
				if (!body || typeof body !== 'object') {
					return new BtcaError(fallbackMessage);
				}
				const parsed = body as { error?: string; hint?: string; tag?: string };
				return new BtcaError(normalizeMessage(parsed.error ?? fallbackMessage), {
					hint: parsed.hint,
					tag: parsed.tag
				});
			}
		}
	);
};

const requestJson = <T>(
	url: string,
	init: RequestInit | undefined,
	fallbackMessage: string
): Effect.Effect<T, BtcaError> =>
	Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			try: () => fetch(url, init),
			catch: (error) => new BtcaError(String(error))
		});
		if (!response.ok) {
			const parsedError = yield* parseErrorResponse(
				response,
				`${fallbackMessage}: ${response.status}`
			);
			return yield* Effect.fail(parsedError);
		}
		return (yield* Effect.tryPromise({
			try: () => response.json() as Promise<T>,
			catch: (error) => new BtcaError(String(error))
		})) as T;
	});

/**
 * Create an HTTP client descriptor for the btca server
 */
export function createClient(baseUrl: string): Client {
	return { baseUrl };
}

/**
 * Get server configuration
 */
export const getConfigEffect = (client: Client): Effect.Effect<ConfigResponse, BtcaError> =>
	requestJson<ConfigResponse>(`${client.baseUrl}/config`, undefined, 'Failed to get config');

export const getConfig = (client: Client) => Effect.runPromise(getConfigEffect(client));

/**
 * Get available resources
 */
export const getResourcesEffect = (client: Client): Effect.Effect<ResourcesResponse, BtcaError> =>
	requestJson<ResourcesResponse>(
		`${client.baseUrl}/resources`,
		undefined,
		'Failed to get resources'
	);

export const getResources = (client: Client) => Effect.runPromise(getResourcesEffect(client));

export const getProvidersEffect = (client: Client): Effect.Effect<ProvidersResponse, BtcaError> =>
	requestJson<ProvidersResponse>(
		`${client.baseUrl}/providers`,
		undefined,
		'Failed to get providers'
	);

export const getProviders = (client: Client) => Effect.runPromise(getProvidersEffect(client));

/**
 * Ask a question (non-streaming)
 */
export const askQuestionEffect = (
	client: Client,
	options: {
		question: string;
		resources?: string[];
		quiet?: boolean;
	}
): Effect.Effect<{ answer: string; model: { provider: string; model: string } }, BtcaError> =>
	requestJson<{ answer: string; model: { provider: string; model: string } }>(
		`${client.baseUrl}/question`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				question: options.question,
				resources: options.resources,
				quiet: options.quiet
			})
		},
		'Failed to ask question'
	);

export const askQuestion = (
	client: Client,
	options: {
		question: string;
		resources?: string[];
		quiet?: boolean;
	}
) => Effect.runPromise(askQuestionEffect(client, options));

/**
 * Ask a question (streaming) - returns the raw Response for SSE parsing
 */
export const askQuestionStreamEffect = (
	baseUrl: string,
	options: {
		question: string;
		resources?: string[];
		quiet?: boolean;
		signal?: AbortSignal;
	}
): Effect.Effect<Response, BtcaError> =>
	Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			try: () =>
				fetch(`${baseUrl}/question/stream`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						question: options.question,
						resources: options.resources,
						quiet: options.quiet
					}),
					signal: options.signal
				}),
			catch: (error) => new BtcaError(String(error))
		});

		if (!response.ok) {
			const parsedError = yield* parseErrorResponse(
				response,
				`Failed to ask question: ${response.status}`
			);
			return yield* Effect.fail(parsedError);
		}

		return response;
	});

export const askQuestionStream = (
	baseUrl: string,
	options: {
		question: string;
		resources?: string[];
		quiet?: boolean;
		signal?: AbortSignal;
	}
) => Effect.runPromise(askQuestionStreamEffect(baseUrl, options));

/**
 * Update model configuration
 */
export type ProviderOptionsInput = {
	baseURL?: string;
	name?: string;
};

export type ModelUpdateResult = {
	provider: string;
	model: string;
	savedTo: 'project' | 'global';
};

export const updateModelEffect = (
	baseUrl: string,
	provider: string,
	model: string,
	providerOptions?: ProviderOptionsInput
): Effect.Effect<ModelUpdateResult, BtcaError> =>
	requestJson<ModelUpdateResult>(
		`${baseUrl}/config/model`,
		{
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				provider,
				model,
				...(providerOptions ? { providerOptions } : {})
			})
		},
		'Failed to update model'
	);

export const updateModel = (
	baseUrl: string,
	provider: string,
	model: string,
	providerOptions?: ProviderOptionsInput
) => Effect.runPromise(updateModelEffect(baseUrl, provider, model, providerOptions));

export interface GitResourceInput {
	type: 'git';
	name: string;
	url: string;
	branch?: string;
	searchPath?: string;
	searchPaths?: string[];
	specialNotes?: string;
}

export interface LocalResourceInput {
	type: 'local';
	name: string;
	path: string;
	specialNotes?: string;
}

export interface NpmResourceInput {
	type: 'npm';
	name: string;
	package: string;
	version?: string;
	specialNotes?: string;
}

export type ResourceInput = GitResourceInput | LocalResourceInput | NpmResourceInput;

/**
 * Add a new resource
 */
export const addResourceEffect = (
	baseUrl: string,
	resource: ResourceInput
): Effect.Effect<ResourceInput, BtcaError> =>
	requestJson<ResourceInput>(
		`${baseUrl}/config/resources`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(resource)
		},
		'Failed to add resource'
	);

export const addResource = (baseUrl: string, resource: ResourceInput) =>
	Effect.runPromise(addResourceEffect(baseUrl, resource));

/**
 * Remove a resource
 */
export const removeResourceEffect = (
	baseUrl: string,
	name: string
): Effect.Effect<void, BtcaError> =>
	Effect.asVoid(
		requestJson<{ success: boolean }>(
			`${baseUrl}/config/resources`,
			{
				method: 'DELETE',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ name })
			},
			'Failed to remove resource'
		)
	);

export const removeResource = (baseUrl: string, name: string) =>
	Effect.runPromise(removeResourceEffect(baseUrl, name));

/**
 * Clear all locally cloned resources
 */
export const clearResourcesEffect = (
	baseUrl: string
): Effect.Effect<{ cleared: number }, BtcaError> =>
	requestJson<{ cleared: number }>(
		`${baseUrl}/clear`,
		{
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			}
		},
		'Failed to clear resources'
	);

export const clearResources = (baseUrl: string) => Effect.runPromise(clearResourcesEffect(baseUrl));
