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
import { Result } from 'better-result';

export namespace Auth {
	// Auth schema matching OpenCode's format
	const ApiKeyAuthSchema = z.object({
		type: z.literal('api'),
		key: z.string()
	});

	const OAuthAuthSchema = z.object({
		type: z.literal('oauth'),
		access: z.string(),
		refresh: z.string(),
		expires: z.number()
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

	/**
	 * Get the path to OpenCode's data directory
	 */
	function getDataPath(): string {
		const platform = os.platform();

		if (platform === 'win32') {
			const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
			return path.join(appdata, 'opencode');
		}

		// Linux and macOS use XDG_DATA_HOME or ~/.local/share
		const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
		return path.join(xdgData, 'opencode');
	}

	/**
	 * Get the path to the auth.json file
	 */
	function getAuthFilePath(): string {
		return path.join(getDataPath(), 'auth.json');
	}

	/**
	 * Read and parse the auth file
	 */
	async function readAuthFile(): Promise<Record<string, AuthInfo>> {
		const filepath = getAuthFilePath();
		const file = Bun.file(filepath);

		if (!(await file.exists())) {
			return {};
		}

		const result = await Result.tryPromise(() => file.json());
		return result.match({
			ok: (content) => {
				const parsed = AuthFileSchema.safeParse(content);
				if (!parsed.success) {
					console.warn('Invalid auth.json format:', parsed.error);
					return {};
				}
				return parsed.data;
			},
			err: (error) => {
				console.warn('Failed to read auth.json:', error);
				return {};
			}
		});
	}

	/**
	 * Get stored credentials for a provider
	 * Returns undefined if no credentials are stored
	 */
	export async function getCredentials(providerId: string): Promise<AuthInfo | undefined> {
		const authData = await readAuthFile();
		return authData[providerId];
	}

	/**
	 * Check if a provider is authenticated
	 */
	export async function isAuthenticated(providerId: string): Promise<boolean> {
		const auth = await getCredentials(providerId);
		return auth !== undefined;
	}

	/**
	 * Get the API key or access token for a provider
	 * Returns undefined if not authenticated or no key available
	 */
	export async function getApiKey(providerId: string): Promise<string | undefined> {
		const auth = await getCredentials(providerId);
		if (!auth) return undefined;

		if (auth.type === 'api') {
			return auth.key;
		}

		if (auth.type === 'oauth') {
			return auth.access;
		}

		// wellknown auth doesn't have an API key
		return undefined;
	}

	/**
	 * Get all stored credentials
	 */
	export async function getAllCredentials(): Promise<Record<string, AuthInfo>> {
		return readAuthFile();
	}

	/**
	 * Get the list of all authenticated provider IDs
	 */
	export async function getAuthenticatedProviders(): Promise<string[]> {
		const authData = await readAuthFile();
		return Object.keys(authData);
	}
}
