/**
 * Remote API client for btca cloud service.
 * Communicates with the web app's API endpoints via the MCP protocol.
 */

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

			try {
				const body = (await response.json()) as { error?: string; hint?: string };
				if (body.error) errorMessage = body.error;
				if (body.hint) hint = body.hint;
			} catch {
				// Ignore JSON parse errors
			}

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
			return JSON.parse(dataLine.slice(6)) as T;
		}

		return response.json() as Promise<T>;
	}

	/**
	 * Validate the API key and get basic info
	 */
	async validate(): Promise<{ valid: boolean; error?: string }> {
		try {
			// Use the MCP listResources endpoint to validate
			const result = await this.listResources();
			return { valid: result.ok };
		} catch (error) {
			if (error instanceof RemoteApiError && error.statusCode === 401) {
				return { valid: false, error: 'Invalid or expired API key' };
			}
			throw error;
		}
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
			try {
				const parsed = JSON.parse(errorText) as { error?: string };
				return { ok: false, error: parsed.error ?? errorText };
			} catch {
				return { ok: false, error: errorText };
			}
		}

		const text = response.result?.content[0]?.text ?? '[]';
		try {
			const resources = JSON.parse(text) as RemoteResource[];
			return { ok: true, resources };
		} catch {
			return { ok: false, error: 'Failed to parse resources' };
		}
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
			try {
				const parsed = JSON.parse(errorText) as { error?: string };
				return { ok: false, error: parsed.error ?? errorText };
			} catch {
				return { ok: false, error: errorText };
			}
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
			try {
				const parsed = JSON.parse(errorText) as { error?: string };
				return { ok: false, error: parsed.error ?? errorText };
			} catch {
				return { ok: false, error: errorText };
			}
		}

		const text = response.result?.content[0]?.text ?? '{}';
		try {
			const result = JSON.parse(text) as RemoteResource;
			return { ok: true, resource: result };
		} catch {
			return { ok: true, resource: { name: resource.name } as RemoteResource };
		}
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
			try {
				const parsed = JSON.parse(errorText) as { error?: string };
				return { ok: false, errors: [parsed.error ?? errorText], synced: [] };
			} catch {
				return { ok: false, errors: [errorText], synced: [] };
			}
		}

		const text = response.result?.content[0]?.text ?? '{}';
		try {
			return JSON.parse(text) as SyncResult;
		} catch {
			return { ok: true, synced: [] };
		}
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
		try {
			const result = await this.request<{
				instance: RemoteInstance;
				project?: RemoteProject;
			}>(`/api/cli/status${project ? `?project=${encodeURIComponent(project)}` : ''}`);
			return { ok: true, ...result };
		} catch (error) {
			if (error instanceof RemoteApiError) {
				return { ok: false, error: error.message };
			}
			throw error;
		}
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
		try {
			const result = await this.request<{ serverUrl: string }>('/api/cli/wake', {
				method: 'POST'
			});
			return { ok: true, serverUrl: result.serverUrl };
		} catch (error) {
			if (error instanceof RemoteApiError) {
				return { ok: false, error: error.message };
			}
			throw error;
		}
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
		try {
			const result = await this.request<{
				thread: RemoteThread;
				messages: RemoteMessage[];
			}>(`/api/cli/threads/${threadId}`);
			return { ok: true, ...result };
		} catch (error) {
			if (error instanceof RemoteApiError) {
				return { ok: false, error: error.message };
			}
			throw error;
		}
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
		try {
			const result = await this.request<{ threads: RemoteThread[] }>(
				`/api/cli/threads${project ? `?project=${encodeURIComponent(project)}` : ''}`
			);
			return { ok: true, threads: result.threads };
		} catch (error) {
			if (error instanceof RemoteApiError) {
				return { ok: false, error: error.message };
			}
			throw error;
		}
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
		try {
			const result = await this.request<{ questions: McpQuestion[] }>(
				`/api/cli/questions?project=${encodeURIComponent(project)}`
			);
			return { ok: true, questions: result.questions };
		} catch (error) {
			if (error instanceof RemoteApiError) {
				return { ok: false, error: error.message };
			}
			throw error;
		}
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
		try {
			const result = await this.request<{ projects: RemoteProject[] }>('/api/cli/projects');
			return { ok: true, projects: result.projects };
		} catch (error) {
			if (error instanceof RemoteApiError) {
				return { ok: false, error: error.message };
			}
			throw error;
		}
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
