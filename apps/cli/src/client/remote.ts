/**
 * Remote API client for btca cloud service.
 * Communicates with the web app's API endpoints via the MCP protocol.
 */

import { Result } from 'better-result';

// TODO: Change back to 'https://btca.dev' before deploying!
const DEFAULT_REMOTE_URL = 'https://btca.dev';

// Local type definitions to avoid circular dependencies
export interface GitResource {
	type: 'git';
	name: string;
	url: string;
	branch: string;
	searchPath?: string;
	searchPaths?: string[];
	specialNotes?: string;
}

export interface RemoteConfig {
	$schema?: string;
	project: string;
	model?: 'claude-sonnet' | 'claude-haiku' | 'gpt-4o' | 'gpt-4o-mini';
	resources: GitResource[];
}

export interface RemoteClientOptions {
	apiKey: string;
	baseUrl?: string;
}

export interface RemoteResource {
	name: string;
	displayName: string;
	type: string;
	url: string;
	branch: string;
	searchPath?: string;
	specialNotes?: string;
	isGlobal: boolean;
}

export interface RemoteProject {
	_id: string;
	name: string;
	model?: string;
	isDefault: boolean;
	createdAt: number;
}

export interface RemoteInstance {
	_id: string;
	state:
		| 'unprovisioned'
		| 'provisioning'
		| 'stopped'
		| 'starting'
		| 'running'
		| 'stopping'
		| 'updating'
		| 'error';
	serverUrl?: string;
	btcaVersion?: string;
	subscriptionPlan?: 'pro' | 'free' | 'none';
}

export interface RemoteThread {
	_id: string;
	title?: string;
	createdAt: number;
	lastActivityAt: number;
}

export interface RemoteMessage {
	_id: string;
	threadId: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	resources?: string[];
	createdAt: number;
}

export interface McpQuestion {
	_id: string;
	projectId: string;
	question: string;
	resources: string[];
	answer: string;
	createdAt: number;
}

export interface SyncResult {
	ok: boolean;
	errors?: string[];
	synced: string[];
	conflicts?: Array<{
		name: string;
		local: GitResource;
		remote: RemoteResource;
	}>;
}

export class RemoteApiError extends Error {
	readonly statusCode?: number;
	readonly hint?: string;

	constructor(message: string, options?: { statusCode?: number; hint?: string }) {
		super(message);
		this.name = 'RemoteApiError';
		this.statusCode = options?.statusCode;
		this.hint = options?.hint;
	}
}

const parseJsonText = (text: string): unknown | null => {
	const result = Result.try(() => JSON.parse(text));
	return Result.isOk(result) ? result.value : null;
};

const parseErrorText = (text: string) => {
	const parsed = parseJsonText(text) as { error?: string } | null;
	return parsed?.error ?? text;
};

const getRemoteApiError = (error: unknown): RemoteApiError | null => {
	if (error instanceof RemoteApiError) return error;
	if (error && typeof error === 'object' && 'cause' in error) {
		const cause = (error as { cause?: unknown }).cause;
		if (cause instanceof RemoteApiError) return cause;
	}
	return null;
};

/**
 * Remote API client
 */
export class RemoteClient {
	private readonly apiKey: string;
	private readonly baseUrl: string;

	constructor(options: RemoteClientOptions) {
		this.apiKey = options.apiKey;
		this.baseUrl = options.baseUrl ?? DEFAULT_REMOTE_URL;
	}

	private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const headers = new Headers(options.headers);
		headers.set('Authorization', `Bearer ${this.apiKey}`);
		headers.set('Content-Type', 'application/json');

		const response = await fetch(url, {
			...options,
			headers
		});

		if (!response.ok) {
			let errorMessage = `Request failed: ${response.status}`;
			let hint: string | undefined;

			const bodyResult = await Result.tryPromise(() => response.json());
			bodyResult.match({
				ok: (body) => {
					const parsed = body as { error?: string; hint?: string };
					if (parsed.error) errorMessage = parsed.error;
					if (parsed.hint) hint = parsed.hint;
				},
				err: () => undefined
			});

			throw new RemoteApiError(errorMessage, {
				statusCode: response.status,
				hint
			});
		}

		const contentType = response.headers.get('content-type') ?? '';

		if (contentType.includes('text/event-stream')) {
			const text = await response.text();
			const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
			if (!dataLine) {
				throw new RemoteApiError('No data in SSE response');
			}
			const parsed = parseJsonText(dataLine.slice(6)) as T | null;
			if (!parsed) throw new RemoteApiError('Failed to parse SSE response');
			return parsed;
		}

		return response.json() as Promise<T>;
	}

	/**
	 * Validate the API key and get basic info
	 */
	async validate(): Promise<{ valid: boolean; error?: string }> {
		const result = await Result.tryPromise(() => this.listResources());
		if (Result.isOk(result)) return { valid: result.value.ok };
		const remoteError = getRemoteApiError(result.error);
		if (remoteError?.statusCode === 401) {
			return { valid: false, error: 'Invalid or expired API key' };
		}
		throw result.error;
	}

	/**
	 * List available resources via MCP
	 */
	async listResources(project?: string): Promise<
		| {
				ok: true;
				resources: RemoteResource[];
		  }
		| {
				ok: false;
				error: string;
		  }
	> {
		// MCP uses JSON-RPC, we need to call the tools/call endpoint
		const mcpRequest = {
			jsonrpc: '2.0',
			id: Date.now(),
			method: 'tools/call',
			params: {
				name: 'listResources',
				arguments: project ? { project } : {}
			}
		};

		const response = await this.request<{
			result?: {
				content: Array<{ type: string; text: string }>;
				isError?: boolean;
			};
			error?: { message: string };
		}>('/api/mcp', {
			method: 'POST',
			body: JSON.stringify(mcpRequest)
		});

		if (response.error) {
			return { ok: false, error: response.error.message };
		}

		if (response.result?.isError) {
			const errorText = response.result.content[0]?.text ?? 'Unknown error';
			return { ok: false, error: parseErrorText(errorText) };
		}

		const text = response.result?.content[0]?.text ?? '[]';
		const resources = parseJsonText(text) as RemoteResource[] | null;
		return resources ? { ok: true, resources } : { ok: false, error: 'Failed to parse resources' };
	}

	/**
	 * Ask a question via MCP
	 */
	async ask(
		question: string,
		resources: string[],
		project?: string
	): Promise<
		| {
				ok: true;
				text: string;
		  }
		| {
				ok: false;
				error: string;
		  }
	> {
		const mcpRequest = {
			jsonrpc: '2.0',
			id: Date.now(),
			method: 'tools/call',
			params: {
				name: 'ask',
				arguments: {
					question,
					resources,
					...(project && { project })
				}
			}
		};

		const response = await this.request<{
			result?: {
				content: Array<{ type: string; text: string }>;
				isError?: boolean;
			};
			error?: { message: string };
		}>('/api/mcp', {
			method: 'POST',
			body: JSON.stringify(mcpRequest)
		});

		if (response.error) {
			return { ok: false, error: response.error.message };
		}

		if (response.result?.isError) {
			const errorText = response.result.content[0]?.text ?? 'Unknown error';
			return { ok: false, error: parseErrorText(errorText) };
		}

		return {
			ok: true,
			text: response.result?.content[0]?.text ?? ''
		};
	}

	/**
	 * Add a resource via MCP
	 */
	async addResource(
		resource: GitResource,
		project?: string
	): Promise<
		| {
				ok: true;
				resource: RemoteResource;
		  }
		| {
				ok: false;
				error: string;
		  }
	> {
		const mcpRequest = {
			jsonrpc: '2.0',
			id: Date.now(),
			method: 'tools/call',
			params: {
				name: 'addResource',
				arguments: {
					url: resource.url,
					name: resource.name,
					branch: resource.branch,
					...(resource.searchPath && { searchPath: resource.searchPath }),
					...(resource.searchPaths && { searchPaths: resource.searchPaths }),
					...(resource.specialNotes && { notes: resource.specialNotes }),
					...(project && { project })
				}
			}
		};

		const response = await this.request<{
			result?: {
				content: Array<{ type: string; text: string }>;
				isError?: boolean;
			};
			error?: { message: string };
		}>('/api/mcp', {
			method: 'POST',
			body: JSON.stringify(mcpRequest)
		});

		if (response.error) {
			return { ok: false, error: response.error.message };
		}

		if (response.result?.isError) {
			const errorText = response.result.content[0]?.text ?? 'Unknown error';
			return { ok: false, error: parseErrorText(errorText) };
		}

		const text = response.result?.content[0]?.text ?? '{}';
		const parsed = parseJsonText(text) as RemoteResource | null;
		return parsed
			? { ok: true, resource: parsed }
			: { ok: true, resource: { name: resource.name } as RemoteResource };
	}

	/**
	 * Sync config with cloud
	 */
	async sync(config: RemoteConfig, force?: boolean): Promise<SyncResult> {
		const mcpRequest = {
			jsonrpc: '2.0',
			id: Date.now(),
			method: 'tools/call',
			params: {
				name: 'sync',
				arguments: {
					config: JSON.stringify(config),
					force: force ?? false
				}
			}
		};

		const response = await this.request<{
			result?: {
				content: Array<{ type: string; text: string }>;
				isError?: boolean;
			};
			error?: { message: string };
		}>('/api/mcp', {
			method: 'POST',
			body: JSON.stringify(mcpRequest)
		});

		if (response.error) {
			return { ok: false, errors: [response.error.message], synced: [] };
		}

		if (response.result?.isError) {
			const errorText = response.result.content[0]?.text ?? 'Unknown error';
			return { ok: false, errors: [parseErrorText(errorText)], synced: [] };
		}

		const text = response.result?.content[0]?.text ?? '{}';
		const parsed = parseJsonText(text) as SyncResult | null;
		return parsed ?? { ok: true, synced: [] };
	}

	/**
	 * Get instance status via the CLI API
	 */
	async getStatus(project?: string): Promise<
		| {
				ok: true;
				instance: RemoteInstance;
				project?: RemoteProject;
		  }
		| {
				ok: false;
				error: string;
		  }
	> {
		const result = await Result.tryPromise(() =>
			this.request<{ instance: RemoteInstance; project?: RemoteProject }>(
				`/api/cli/status${project ? `?project=${encodeURIComponent(project)}` : ''}`
			)
		);
		if (Result.isOk(result)) {
			return { ok: true, ...result.value };
		}
		const remoteError = getRemoteApiError(result.error);
		if (remoteError) return { ok: false, error: remoteError.message };
		throw result.error;
	}

	/**
	 * Wake the sandbox via the CLI API
	 */
	async wake(): Promise<
		| {
				ok: true;
				serverUrl: string;
		  }
		| {
				ok: false;
				error: string;
		  }
	> {
		const result = await Result.tryPromise(() =>
			this.request<{ serverUrl: string }>('/api/cli/wake', { method: 'POST' })
		);
		if (Result.isOk(result)) {
			return { ok: true, serverUrl: result.value.serverUrl };
		}
		const remoteError = getRemoteApiError(result.error);
		if (remoteError) return { ok: false, error: remoteError.message };
		throw result.error;
	}

	/**
	 * Get thread transcript via the CLI API
	 */
	async getThread(threadId: string): Promise<
		| {
				ok: true;
				thread: RemoteThread;
				messages: RemoteMessage[];
		  }
		| {
				ok: false;
				error: string;
		  }
	> {
		const result = await Result.tryPromise(() =>
			this.request<{ thread: RemoteThread; messages: RemoteMessage[] }>(
				`/api/cli/threads/${threadId}`
			)
		);
		if (Result.isOk(result)) {
			return { ok: true, ...result.value };
		}
		const remoteError = getRemoteApiError(result.error);
		if (remoteError) return { ok: false, error: remoteError.message };
		throw result.error;
	}

	/**
	 * List threads via the CLI API
	 */
	async listThreads(project?: string): Promise<
		| {
				ok: true;
				threads: RemoteThread[];
		  }
		| {
				ok: false;
				error: string;
		  }
	> {
		const result = await Result.tryPromise(() =>
			this.request<{ threads: RemoteThread[] }>(
				`/api/cli/threads${project ? `?project=${encodeURIComponent(project)}` : ''}`
			)
		);
		if (Result.isOk(result)) {
			return { ok: true, threads: result.value.threads };
		}
		const remoteError = getRemoteApiError(result.error);
		if (remoteError) return { ok: false, error: remoteError.message };
		throw result.error;
	}

	/**
	 * List MCP questions for a project via the CLI API
	 */
	async listQuestions(project: string): Promise<
		| {
				ok: true;
				questions: McpQuestion[];
		  }
		| {
				ok: false;
				error: string;
		  }
	> {
		const result = await Result.tryPromise(() =>
			this.request<{ questions: McpQuestion[] }>(
				`/api/cli/questions?project=${encodeURIComponent(project)}`
			)
		);
		if (Result.isOk(result)) {
			return { ok: true, questions: result.value.questions };
		}
		const remoteError = getRemoteApiError(result.error);
		if (remoteError) return { ok: false, error: remoteError.message };
		throw result.error;
	}

	/**
	 * List projects via the CLI API
	 */
	async listProjects(): Promise<
		| {
				ok: true;
				projects: RemoteProject[];
		  }
		| {
				ok: false;
				error: string;
		  }
	> {
		const result = await Result.tryPromise(() =>
			this.request<{ projects: RemoteProject[] }>('/api/cli/projects')
		);
		if (Result.isOk(result)) {
			return { ok: true, projects: result.value.projects };
		}
		const remoteError = getRemoteApiError(result.error);
		if (remoteError) return { ok: false, error: remoteError.message };
		throw result.error;
	}
}

/**
 * Create a remote client from stored auth
 */
export async function createRemoteClientFromAuth(
	loadAuth: () => Promise<{ apiKey: string } | null>
): Promise<RemoteClient | null> {
	const auth = await loadAuth();
	if (!auth) return null;
	return new RemoteClient({ apiKey: auth.apiKey });
}
