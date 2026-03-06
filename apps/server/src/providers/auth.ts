/**
 * Auth wrapper that reads from OpenCode's auth storage
 * Provides credential storage and retrieval for AI providers
 *
 * OpenCode stores credentials at:
 * - Linux: ~/.local/share/opencode/auth.json
 * - macOS: ~/.local/share/opencode/auth.json (uses XDG on macOS too)
 * - Windows: %APPDATA%/opencode/auth.json
 */
import * as path from 'node:path';
import * as os from 'node:os';
import { z } from 'zod';

export type AuthType = 'api' | 'oauth' | 'wellknown';

export type AuthStatus =
	| { status: 'ok'; authType: AuthType; apiKey?: string; accountId?: string }
	| { status: 'missing' }
	| { status: 'invalid'; authType: AuthType };

const PROVIDER_AUTH_TYPES: Record<string, readonly AuthType[]> = {
	opencode: ['api'],
	'github-copilot': ['oauth'],
	openrouter: ['api'],
	openai: ['oauth'],
	'openai-compat': ['api'],
	anthropic: ['api', 'oauth'],
	google: ['api', 'oauth'],
	minimax: ['api']
};

const readEnv = (key: string) => {
	const value = process.env[key];
	return value && value.trim().length > 0 ? value.trim() : undefined;
};

const getEnvApiKey = (providerId: string) => {
	if (providerId === 'openrouter') return readEnv('OPENROUTER_API_KEY');
	if (providerId === 'opencode') return readEnv('OPENCODE_API_KEY');
	if (providerId === 'minimax') return readEnv('MINIMAX_API_KEY');
	return undefined;
};

const ApiKeyAuthSchema = z.object({
	type: z.literal('api'),
	key: z.string()
});

const OAuthAuthSchema = z.object({
	type: z.literal('oauth'),
	access: z.string(),
	refresh: z.string(),
	expires: z.number(),
	accountId: z.string().optional()
});

const WellKnownAuthSchema = z.object({
	type: z.literal('wellknown')
});

const AuthInfoSchema = z.union([ApiKeyAuthSchema, OAuthAuthSchema, WellKnownAuthSchema]);
const AuthFileSchema = z.record(z.string(), AuthInfoSchema);

export type ApiKeyAuth = z.infer<typeof ApiKeyAuthSchema>;
export type OAuthAuth = z.infer<typeof OAuthAuthSchema>;
export type WellKnownAuth = z.infer<typeof WellKnownAuthSchema>;
export type AuthInfo = z.infer<typeof AuthInfoSchema>;

const getDataPath = (): string => {
	const platform = os.platform();

	if (platform === 'win32') {
		const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
		return path.join(appdata, 'opencode');
	}

	const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
	return path.join(xdgData, 'opencode');
};

const getAuthFilePath = (): string => path.join(getDataPath(), 'auth.json');

const readAuthFile = async (): Promise<Record<string, AuthInfo>> => {
	const filepath = getAuthFilePath();
	const file = Bun.file(filepath);

	if (!(await file.exists())) {
		return {};
	}

	try {
		const content = await file.json();
		const parsed = AuthFileSchema.safeParse(content);
		if (!parsed.success) {
			console.warn('Invalid auth.json format:', parsed.error);
			return {};
		}
		return parsed.data;
	} catch (error) {
		console.warn('Failed to read auth.json:', error);
		return {};
	}
};

export const getCredentials = async (providerId: string): Promise<AuthInfo | undefined> => {
	const authData = await readAuthFile();
	if (providerId === 'openrouter') {
		return authData.openrouter ?? authData['openrouter.ai'] ?? authData['openrouter-ai'];
	}
	return authData[providerId];
};

export const getAuthStatus = async (providerId: string): Promise<AuthStatus> => {
	const allowedTypes = PROVIDER_AUTH_TYPES[providerId];
	if (!allowedTypes) return { status: 'missing' };

	const envKey = getEnvApiKey(providerId);
	if (envKey) {
		return allowedTypes.includes('api')
			? { status: 'ok', authType: 'api', apiKey: envKey }
			: { status: 'invalid', authType: 'api' };
	}

	const auth = await getCredentials(providerId);
	if (!auth) return { status: 'missing' };

	if (!allowedTypes.includes(auth.type)) {
		return { status: 'invalid', authType: auth.type };
	}

	const oauthKey =
		auth.type === 'oauth'
			? providerId === 'github-copilot'
				? auth.refresh
				: auth.access
			: undefined;
	const apiKey = auth.type === 'api' ? auth.key : auth.type === 'oauth' ? oauthKey : undefined;
	const accountId = auth.type === 'oauth' ? auth.accountId : undefined;
	return { status: 'ok', authType: auth.type, apiKey, accountId };
};

export const getProviderAuthHint = (providerId: string) => {
	switch (providerId) {
		case 'github-copilot':
			return 'Run "btca connect -p github-copilot" and complete device flow OAuth.';
		case 'openai':
			return 'Run "opencode auth --provider openai" and complete OAuth.';
		case 'openai-compat':
			return 'Set baseURL + name via "btca connect" and optionally add an API key.';
		case 'anthropic':
			return 'Run "opencode auth --provider anthropic" to authenticate with your Anthropic Pro/Max plan (OAuth) or enter an API key.';
		case 'google':
			return 'Run "opencode auth --provider google" and enter an API key or OAuth.';
		case 'openrouter':
			return 'Set OPENROUTER_API_KEY or run "opencode auth --provider openrouter".';
		case 'opencode':
			return 'Set OPENCODE_API_KEY or run "opencode auth --provider opencode".';
		case 'minimax':
			return 'Run "btca connect -p minimax" and enter your API key. Get your API key at https://platform.minimax.io/user-center/basic-information.';
		default:
			return 'Run "btca connect" and configure credentials for this provider.';
	}
};

export const isAuthenticated = async (providerId: string): Promise<boolean> => {
	const status = await getAuthStatus(providerId);
	return status.status === 'ok';
};

export const getApiKey = async (providerId: string): Promise<string | undefined> => {
	const status = await getAuthStatus(providerId);
	if (status.status !== 'ok') return undefined;
	return status.apiKey;
};

export const getAllCredentials = async (): Promise<Record<string, AuthInfo>> => readAuthFile();

export const setCredentials = async (providerId: string, info: AuthInfo): Promise<void> => {
	const filepath = getAuthFilePath();
	const existing = await readAuthFile();
	const next = { ...existing, [providerId]: info };
	await Bun.write(filepath, JSON.stringify(next, null, 2), { mode: 0o600 });
};

export const getAuthenticatedProviders = async (): Promise<string[]> => {
	const providers = Object.keys(PROVIDER_AUTH_TYPES);
	const statuses = await Promise.all(providers.map((provider) => getAuthStatus(provider)));
	return providers.filter((_, index) => statuses[index]?.status === 'ok');
};

const ANTHROPIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const ANTHROPIC_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const TOOL_PREFIX = 'mcp_';

// Module-level deduplication lock for token refresh only.
// No token state is cached here — credentials are always read fresh from
// auth.json on each request, avoiding stale-credential race conditions.
let _oauthRefreshPromise: Promise<void> | null = null;

const _refreshAnthropicToken = async (): Promise<void> => {
	const auth = await getCredentials('anthropic');
	if (!auth || auth.type !== 'oauth') throw new Error('Anthropic OAuth credentials not found');
	const response = await fetch(ANTHROPIC_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			grant_type: 'refresh_token',
			refresh_token: auth.refresh,
			client_id: ANTHROPIC_CLIENT_ID
		})
	});
	if (!response.ok) {
		throw new Error(`Anthropic token refresh failed: ${response.status}`);
	}
	const json = (await response.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
	};
	await setCredentials('anthropic', {
		type: 'oauth',
		access: json.access_token,
		refresh: json.refresh_token,
		expires: Date.now() + json.expires_in * 1000,
		accountId: auth.accountId
	});
};

/**
 * Returns a custom fetch function for Anthropic OAuth (Pro/Max plan).
 * Reads credentials fresh from auth.json on every request — no cached token
 * state — so there are no stale-credential race conditions across concurrent
 * getModel() calls. Only the in-flight refresh promise is module-level, to
 * prevent concurrent callers from consuming the single-use refresh token twice.
 *
 * Mirrors the opencode-anthropic-auth plugin behaviour:
 * - Injects Authorization: Bearer header using the OAuth access token
 * - Handles token refresh when expired
 * - Adds required anthropic-beta headers for OAuth
 * - Appends ?beta=true to /v1/messages requests
 * - Sanitizes system prompts (OpenCode → Claude Code)
 * - Prefixes tool names with mcp_ in requests, strips prefix in responses
 */
export const createAnthropicOAuthFetch = (): typeof globalThis.fetch => {
	return async (input, init) => {
		// Read credentials fresh from auth.json on every request
		const authInfo = await getCredentials('anthropic');
		const auth = authInfo?.type === 'oauth' ? (authInfo as OAuthAuth) : null;

		// Refresh token if expired or missing — deduplicate concurrent refresh calls
		// since Anthropic refresh tokens are single-use
		if (!auth?.access || auth.expires < Date.now()) {
			if (!_oauthRefreshPromise) {
				_oauthRefreshPromise = _refreshAnthropicToken().finally(() => {
					_oauthRefreshPromise = null;
				});
			}
			await _oauthRefreshPromise;
		}

		// Re-read credentials after potential refresh
		const freshAuthInfo = await getCredentials('anthropic');
		const freshAuth = freshAuthInfo?.type === 'oauth' ? (freshAuthInfo as OAuthAuth) : null;
		const accessToken = freshAuth?.access ?? '';

		// Build headers from incoming request
		const requestHeaders = new Headers();
		if (input instanceof Request) {
			input.headers.forEach((value, key) => requestHeaders.set(key, value));
		}
		if (init?.headers) {
			if (init.headers instanceof Headers) {
				init.headers.forEach((value, key) => requestHeaders.set(key, value));
			} else if (Array.isArray(init.headers)) {
				for (const [key, value] of init.headers) {
					if (typeof value !== 'undefined') requestHeaders.set(key, String(value));
				}
			} else {
				for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
					if (typeof value !== 'undefined') requestHeaders.set(key, String(value));
				}
			}
		}

		// Merge required OAuth beta flags with any incoming betas
		const incomingBeta = requestHeaders.get('anthropic-beta') ?? '';
		const incomingBetas = incomingBeta
			.split(',')
			.map((b) => b.trim())
			.filter(Boolean);
		const requiredBetas = ['oauth-2025-04-20', 'interleaved-thinking-2025-05-14'];
		const mergedBetas = [...new Set([...requiredBetas, ...incomingBetas])].join(',');

		requestHeaders.set('authorization', `Bearer ${accessToken}`);
		requestHeaders.set('anthropic-beta', mergedBetas);
		requestHeaders.set('user-agent', 'claude-cli/2.1.2 (external, cli)');
		requestHeaders.delete('x-api-key');

		// Body transformations: sanitize system prompts + prefix tool names
		let body = init?.body;
		if (body && typeof body === 'string') {
			try {
				const parsed = JSON.parse(body) as Record<string, unknown>;

				// Sanitize system prompt — Anthropic's OAuth endpoint blocks "OpenCode"
				if (parsed.system && typeof parsed.system === 'string') {
					parsed.system = parsed.system
						.replace(/OpenCode/g, 'Claude Code')
						.replace(/opencode/gi, 'Claude');
				} else if (parsed.system && Array.isArray(parsed.system)) {
					parsed.system = (parsed.system as Array<{ type: string; text?: string }>).map((item) => {
						if (item.type === 'text' && item.text) {
							return {
								...item,
								text: item.text.replace(/OpenCode/g, 'Claude Code').replace(/opencode/gi, 'Claude')
							};
						}
						return item;
					});
				}

				// Prefix tool names in tool definitions — skip if already prefixed
				// to avoid double-prefixing tools from MCP servers that already use mcp_
				if (parsed.tools && Array.isArray(parsed.tools)) {
					parsed.tools = (parsed.tools as Array<{ name?: string }>).map((tool) => ({
						...tool,
						name:
							tool.name && !tool.name.startsWith(TOOL_PREFIX)
								? `${TOOL_PREFIX}${tool.name}`
								: tool.name
					}));
				}

				// Prefix tool names in message content blocks — skip if already prefixed
				if (parsed.messages && Array.isArray(parsed.messages)) {
					parsed.messages = (
						parsed.messages as Array<{ content?: Array<{ type: string; name?: string }> }>
					).map((msg) => {
						if (msg.content && Array.isArray(msg.content)) {
							msg.content = msg.content.map((block) => {
								if (
									block.type === 'tool_use' &&
									block.name &&
									!block.name.startsWith(TOOL_PREFIX)
								) {
									return { ...block, name: `${TOOL_PREFIX}${block.name}` };
								}
								return block;
							});
						}
						return msg;
					});
				}

				body = JSON.stringify(parsed);
			} catch {
				// ignore parse errors — send body as-is
			}
		}

		// Append ?beta=true to /v1/messages
		let requestInput: RequestInfo | URL = input;
		try {
			let requestUrl: URL | null = null;
			if (typeof input === 'string' || input instanceof URL) {
				requestUrl = new URL(input.toString());
			} else if (input instanceof Request) {
				requestUrl = new URL(input.url);
			}
			if (
				requestUrl &&
				requestUrl.pathname === '/v1/messages' &&
				!requestUrl.searchParams.has('beta')
			) {
				requestUrl.searchParams.set('beta', 'true');
				requestInput =
					input instanceof Request ? new Request(requestUrl.toString(), input) : requestUrl;
			}
		} catch {
			// ignore URL parse errors
		}

		const response = await fetch(requestInput, {
			...init,
			body,
			headers: requestHeaders
		});

		// Transform streaming response: strip mcp_ prefix from tool names.
		// Only applies to SSE data lines containing tool_use or content_block_start
		// events to avoid corrupting tool result payloads that may contain "name"
		// fields with mcp_-prefixed values in user data.
		// Uses a line buffer to handle SSE lines split across chunk boundaries.
		if (response.body) {
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			const encoder = new TextEncoder();

			const stripMcpPrefix = (line: string): string => {
				// Only rewrite lines that are structured tool name events
				if (
					line.includes('"type":"tool_use"') ||
					line.includes('"type": "tool_use"') ||
					line.includes('"type":"content_block_start"') ||
					line.includes('"type": "content_block_start"')
				) {
					return line.replace(/"name"\s*:\s*"mcp_([^"]+)"/g, '"name": "$1"');
				}
				return line;
			};

			let lineBuffer = '';

			const stream = new ReadableStream({
				async pull(controller) {
					const { done, value } = await reader.read();
					if (done) {
						// Flush any remaining buffered content
						if (lineBuffer) {
							controller.enqueue(encoder.encode(stripMcpPrefix(lineBuffer)));
							lineBuffer = '';
						}
						controller.close();
						return;
					}
					const text = lineBuffer + decoder.decode(value, { stream: true });
					const lines = text.split('\n');
					// Hold back the last element — it may be an incomplete line
					lineBuffer = lines.pop() ?? '';
					const transformed = lines.map(stripMcpPrefix).join('\n') + '\n';
					controller.enqueue(encoder.encode(transformed));
				}
			});

			return new Response(stream, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers
			});
		}

		return response;
	};
};
