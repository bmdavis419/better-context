import { Result } from 'better-result';
import { hc } from 'hono/client';
import type { AppType } from 'btca-server';

export type Client = ReturnType<typeof hc<AppType>>;

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
async function parseErrorResponse(
	res: { json: () => Promise<unknown> },
	fallbackMessage: string
): Promise<BtcaError> {
	const result = await Result.tryPromise(() => res.json());
	return result.match({
		ok: (body) => {
			const parsed = body as { error?: string; hint?: string; tag?: string };
			return new BtcaError(parsed.error ?? fallbackMessage, {
				hint: parsed.hint,
				tag: parsed.tag
			});
		},
		err: () => new BtcaError(fallbackMessage)
	});
}

/**
 * Create a typed Hono RPC client for the btca server
 */
export function createClient(baseUrl: string): Client {
	return hc<AppType>(baseUrl);
}

/**
 * Get server configuration
 */
export async function getConfig(client: Client) {
	const res = await client.config.$get();
	if (!res.ok) {
		throw await parseErrorResponse(res, `Failed to get config: ${res.status}`);
	}
	return res.json();
}

/**
 * Get available resources
 */
export async function getResources(client: Client) {
	const res = await client.resources.$get();
	if (!res.ok) {
		throw await parseErrorResponse(res, `Failed to get resources: ${res.status}`);
	}
	return res.json();
}

export async function getProviders(client: Client) {
	const res = await client.providers.$get();
	if (!res.ok) {
		throw await parseErrorResponse(res, `Failed to get providers: ${res.status}`);
	}
	return res.json();
}

/**
 * Ask a question (non-streaming)
 */
export async function askQuestion(
	client: Client,
	options: {
		question: string;
		resources?: string[];
		quiet?: boolean;
	}
) {
	const res = await client.question.$post({
		json: {
			question: options.question,
			resources: options.resources,
			quiet: options.quiet
		}
	});

	if (!res.ok) {
		throw await parseErrorResponse(res, `Failed to ask question: ${res.status}`);
	}

	return res.json();
}

/**
 * Ask a question (streaming) - returns the raw Response for SSE parsing
 */
export async function askQuestionStream(
	baseUrl: string,
	options: {
		question: string;
		resources?: string[];
		quiet?: boolean;
		signal?: AbortSignal;
	}
): Promise<Response> {
	// Use raw fetch for streaming since Hono client doesn't handle SSE well
	const res = await fetch(`${baseUrl}/question/stream`, {
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
	});

	if (!res.ok) {
		throw await parseErrorResponse(res, `Failed to ask question: ${res.status}`);
	}

	return res;
}

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

export async function updateModel(
	baseUrl: string,
	provider: string,
	model: string,
	providerOptions?: ProviderOptionsInput
): Promise<ModelUpdateResult> {
	const res = await fetch(`${baseUrl}/config/model`, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			provider,
			model,
			...(providerOptions ? { providerOptions } : {})
		})
	});

	if (!res.ok) {
		throw await parseErrorResponse(res, `Failed to update model: ${res.status}`);
	}

	return res.json() as Promise<ModelUpdateResult>;
}

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

export type ResourceInput = GitResourceInput | LocalResourceInput;

/**
 * Add a new resource
 */
export async function addResource(
	baseUrl: string,
	resource: ResourceInput
): Promise<ResourceInput> {
	const res = await fetch(`${baseUrl}/config/resources`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(resource)
	});

	if (!res.ok) {
		throw await parseErrorResponse(res, `Failed to add resource: ${res.status}`);
	}

	return res.json() as Promise<ResourceInput>;
}

/**
 * Remove a resource
 */
export async function removeResource(baseUrl: string, name: string): Promise<void> {
	const res = await fetch(`${baseUrl}/config/resources`, {
		method: 'DELETE',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ name })
	});

	if (!res.ok) {
		throw await parseErrorResponse(res, `Failed to remove resource: ${res.status}`);
	}
}

/**
 * Clear all locally cloned resources
 */
export async function clearResources(baseUrl: string): Promise<{ cleared: number }> {
	const res = await fetch(`${baseUrl}/clear`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		}
	});

	if (!res.ok) {
		throw await parseErrorResponse(res, `Failed to clear resources: ${res.status}`);
	}

	return res.json() as Promise<{ cleared: number }>;
}
