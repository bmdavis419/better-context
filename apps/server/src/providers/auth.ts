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
	atlascloud: ['api'],
	opencode: ['api'],
	'github-copilot': ['oauth'],
	openrouter: ['api'],
	openai: ['oauth'],
	'openai-compat': ['api'],
	anthropic: ['api'],
	google: ['api', 'oauth'],
	minimax: ['api']
};

const readEnv = (key: string) => {
	const value = process.env[key];
	return value && value.trim().length > 0 ? value.trim() : undefined;
};

const getEnvApiKey = (providerId: string) => {
	if (providerId === 'atlascloud') return readEnv('ATLASCLOUD_API_KEY');
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
		case 'atlascloud':
			return 'Set ATLASCLOUD_API_KEY or run "btca connect -p atlascloud".';
		case 'github-copilot':
			return 'Run "btca connect -p github-copilot" and complete device flow OAuth.';
		case 'openai':
			return 'Run "opencode auth --provider openai" and complete OAuth.';
		case 'openai-compat':
			return 'Set baseURL + name via "btca connect" and optionally add an API key.';
		case 'anthropic':
			return 'Run "opencode auth --provider anthropic" and enter an API key.';
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
