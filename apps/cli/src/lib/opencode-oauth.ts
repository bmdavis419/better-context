import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'bun';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const ISSUER = 'https://auth.openai.com';
const OAUTH_PORT = 1455;
const CALLBACK_PATH = '/auth/callback';

type PkceCodes = {
	verifier: string;
	challenge: string;
};

type TokenResponse = {
	id_token?: string;
	access_token: string;
	refresh_token: string;
	expires_in?: number;
};

type IdTokenClaims = {
	chatgpt_account_id?: string;
	organizations?: Array<{ id: string }>;
	email?: string;
	'https://api.openai.com/auth'?: {
		chatgpt_account_id?: string;
	};
};

type OAuthResult = { ok: true } | { ok: false; error: string };

const HTML_SUCCESS = `<!doctype html>
<html>
  <head>
    <title>BTCA - Codex Authorization Successful</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #f1ecec;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to BTCA.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 2000)
    </script>
  </body>
</html>`;

const HTML_ERROR = (error: string) => `<!doctype html>
<html>
  <head>
    <title>BTCA - Codex Authorization Failed</title>
    <style>
      body {
        font-family:
          system-ui,
          -apple-system,
          sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #fc533a;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
      .error {
        color: #ff917b;
        font-family: monospace;
        margin-top: 1rem;
        padding: 1rem;
        background: #3c140d;
        border-radius: 0.5rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${error}</div>
    </div>
  </body>
</html>`;

const generateRandomString = (length: number): string => {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	return Array.from(bytes)
		.map((b) => chars[b % chars.length])
		.join('');
};

const base64UrlEncode = (buffer: ArrayBuffer): string => {
	const bytes = new Uint8Array(buffer);
	const binary = String.fromCharCode(...bytes);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const generateState = (): string =>
	base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer);

const generatePKCE = async (): Promise<PkceCodes> => {
	const verifier = generateRandomString(43);
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hash = await crypto.subtle.digest('SHA-256', data);
	const challenge = base64UrlEncode(hash);
	return { verifier, challenge };
};

const parseJwtClaims = (token: string): IdTokenClaims | undefined => {
	const parts = token.split('.');
	if (parts.length !== 3 || !parts[1]) return undefined;
	try {
		return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as IdTokenClaims;
	} catch {
		return undefined;
	}
};

const extractAccountIdFromClaims = (claims: IdTokenClaims): string | undefined =>
	claims.chatgpt_account_id ||
	claims['https://api.openai.com/auth']?.chatgpt_account_id ||
	claims.organizations?.[0]?.id;

const extractAccountId = (tokens: TokenResponse): string | undefined => {
	if (tokens.id_token) {
		const claims = parseJwtClaims(tokens.id_token);
		const accountId = claims && extractAccountIdFromClaims(claims);
		if (accountId) return accountId;
	}
	if (tokens.access_token) {
		const claims = parseJwtClaims(tokens.access_token);
		return claims ? extractAccountIdFromClaims(claims) : undefined;
	}
	return undefined;
};

const buildAuthorizeUrl = (redirectUri: string, pkce: PkceCodes, state: string): string => {
	const params = new URLSearchParams({
		response_type: 'code',
		client_id: CLIENT_ID,
		redirect_uri: redirectUri,
		scope: 'openid profile email offline_access',
		code_challenge: pkce.challenge,
		code_challenge_method: 'S256',
		id_token_add_organizations: 'true',
		codex_cli_simplified_flow: 'true',
		state,
		originator: 'opencode'
	});
	return `${ISSUER}/oauth/authorize?${params.toString()}`;
};

const exchangeCodeForTokens = async (
	code: string,
	redirectUri: string,
	pkce: PkceCodes
): Promise<TokenResponse> => {
	const response = await fetch(`${ISSUER}/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			client_id: CLIENT_ID,
			code_verifier: pkce.verifier
		}).toString()
	});
	if (!response.ok) {
		throw new Error(`Token exchange failed: ${response.status}`);
	}
	return response.json() as Promise<TokenResponse>;
};

const openBrowser = async (url: string): Promise<void> => {
	const platform = process.platform;
	if (platform === 'darwin') {
		const proc = spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' });
		await proc.exited;
		return;
	}
	if (platform === 'win32') {
		const proc = spawn(['cmd', '/c', 'start', '', url], { stdout: 'ignore', stderr: 'ignore' });
		await proc.exited;
		return;
	}
	const proc = spawn(['xdg-open', url], { stdout: 'ignore', stderr: 'ignore' });
	await proc.exited;
};

const getAuthFilePath = (): string => {
	const platform = os.platform();
	if (platform === 'win32') {
		const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
		return path.join(appdata, 'opencode', 'auth.json');
	}
	const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
	return path.join(xdgData, 'opencode', 'auth.json');
};

const readAuthFile = async (): Promise<Record<string, unknown>> => {
	const filepath = getAuthFilePath();
	const file = Bun.file(filepath);
	if (!(await file.exists())) return {};
	try {
		const content = await file.json();
		return content && typeof content === 'object' ? (content as Record<string, unknown>) : {};
	} catch {
		return {};
	}
};

const writeAuthFile = async (data: Record<string, unknown>): Promise<void> => {
	const filepath = getAuthFilePath();
	await Bun.write(filepath, JSON.stringify(data, null, 2), { mode: 0o600 });
};

export const saveProviderApiKey = async (providerId: string, apiKey: string): Promise<void> => {
	const auth = await readAuthFile();
	auth[providerId] = {
		type: 'api',
		key: apiKey
	};
	await writeAuthFile(auth);
};

export const removeProviderAuth = async (providerId: string): Promise<boolean> => {
	const auth = await readAuthFile();
	if (!(providerId in auth)) {
		return false;
	}
	delete auth[providerId];
	await writeAuthFile(auth);
	return true;
};

export const loginOpenAIOAuth = async (): Promise<OAuthResult> => {
	let server: ReturnType<typeof Bun.serve> | undefined;
	let pending:
		| {
				state: string;
				resolve: (code: string) => void;
				reject: (error: Error) => void;
		  }
		| undefined;

	const waitForCallback = (state: string): Promise<string> =>
		new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() => {
					if (pending) {
						pending = undefined;
						reject(new Error('OAuth callback timeout - authorization took too long'));
					}
				},
				5 * 60 * 1000
			);

			pending = {
				state,
				resolve: (code: string) => {
					clearTimeout(timeout);
					resolve(code);
				},
				reject: (error: Error) => {
					clearTimeout(timeout);
					reject(error);
				}
			};
		});

	const stopServer = () => {
		if (server) {
			server.stop();
			server = undefined;
		}
	};

	try {
		const redirectUri = `http://localhost:${OAUTH_PORT}${CALLBACK_PATH}`;
		server = Bun.serve({
			port: OAUTH_PORT,
			fetch(req) {
				const url = new URL(req.url);
				if (url.pathname !== CALLBACK_PATH) {
					return new Response('Not found', { status: 404 });
				}
				const code = url.searchParams.get('code');
				const state = url.searchParams.get('state');
				const error = url.searchParams.get('error');
				const errorDescription = url.searchParams.get('error_description');

				if (!state) {
					const msg = 'Missing state parameter';
					pending?.reject(new Error(msg));
					pending = undefined;
					return new Response(HTML_ERROR(msg), {
						status: 400,
						headers: { 'Content-Type': 'text/html' }
					});
				}

				if (error) {
					const msg = errorDescription || error;
					pending?.reject(new Error(msg));
					pending = undefined;
					return new Response(HTML_ERROR(msg), {
						headers: { 'Content-Type': 'text/html' }
					});
				}

				if (!code) {
					const msg = 'Missing authorization code';
					pending?.reject(new Error(msg));
					pending = undefined;
					return new Response(HTML_ERROR(msg), {
						status: 400,
						headers: { 'Content-Type': 'text/html' }
					});
				}

				if (!pending || state !== pending.state) {
					const msg = 'Invalid state - potential CSRF attack';
					pending?.reject(new Error(msg));
					pending = undefined;
					return new Response(HTML_ERROR(msg), {
						status: 400,
						headers: { 'Content-Type': 'text/html' }
					});
				}

				const current = pending;
				pending = undefined;
				current.resolve(code);

				return new Response(HTML_SUCCESS, {
					headers: { 'Content-Type': 'text/html' }
				});
			}
		});

		const pkce = await generatePKCE();
		const state = generateState();
		const authUrl = buildAuthorizeUrl(redirectUri, pkce, state);
		console.log(`\nGo to: ${authUrl}\n`);
		await openBrowser(authUrl);

		const code = await waitForCallback(state);
		const tokens = await exchangeCodeForTokens(code, redirectUri, pkce);
		const accountId = extractAccountId(tokens);
		const auth = await readAuthFile();
		auth.openai = {
			type: 'oauth',
			refresh: tokens.refresh_token,
			access: tokens.access_token,
			expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
			...(accountId ? { accountId } : {})
		};
		await writeAuthFile(auth);
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		};
	} finally {
		stopServer();
	}
};
