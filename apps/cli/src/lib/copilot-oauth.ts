import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'bun';

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const CLIENT_ID = 'Ov23lisqVRazqohWrrzS';
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000;
const USER_AGENT = `btca/${process.env.npm_package_version ?? 'dev'} (${os.platform()} ${os.release()}; ${os.arch()})`;

type OAuthResult = { ok: true } | { ok: false; error: string };

const openBrowser = async (url: string) => {
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

const getAuthFilePath = () => {
	const platform = os.platform();
	if (platform === 'win32') {
		const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
		return path.join(appdata, 'opencode', 'auth.json');
	}
	const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
	return path.join(xdgData, 'opencode', 'auth.json');
};

const readAuthFile = async () => {
	const filepath = getAuthFilePath();
	const file = Bun.file(filepath);
	if (!(await file.exists())) return {};
	try {
		const text = await file.text();
		if (text.trim().length === 0) return {};
		const content = JSON.parse(text) as unknown;
		return content && typeof content === 'object' ? (content as Record<string, unknown>) : {};
	} catch {
		return {};
	}
};

const writeAuthFile = async (data: Record<string, unknown>) => {
	const filepath = getAuthFilePath();
	await Bun.write(filepath, JSON.stringify(data, null, 2), { mode: 0o600 });
};

const sleep = (ms: number) => Bun.sleep(ms);

const requestDeviceCode = async (clientId: string) => {
	const response = await fetch(DEVICE_CODE_URL, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'User-Agent': USER_AGENT
		},
		body: JSON.stringify({
			client_id: clientId,
			scope: 'read:user'
		})
	});

	if (!response.ok) {
		const detail = await response.text();
		throw new Error(`Device code request failed: ${response.status} ${detail}`);
	}

	return response.json() as Promise<{
		verification_uri: string;
		user_code: string;
		device_code: string;
		interval: number;
	}>;
};

const pollForToken = async (clientId: string, deviceCode: string, interval: number) => {
	while (true) {
		const response = await fetch(ACCESS_TOKEN_URL, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': USER_AGENT
			},
			body: JSON.stringify({
				client_id: clientId,
				device_code: deviceCode,
				grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
			})
		});

		const data = (await response.json()) as {
			access_token?: string;
			error?: string;
			error_description?: string;
			interval?: number;
		};

		if (data.access_token) return data.access_token;

		if (data.error === 'authorization_pending') {
			await sleep((data.interval ?? interval) * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS);
			continue;
		}

		if (data.error === 'slow_down') {
			await sleep(((data.interval ?? interval) + 5) * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS);
			continue;
		}

		throw new Error(data.error_description || data.error || 'OAuth device flow failed.');
	}
};

export const loginCopilotOAuth = async (): Promise<OAuthResult> => {
	try {
		const device = await requestDeviceCode(CLIENT_ID);
		console.log(`\nGo to: ${device.verification_uri}`);
		console.log(`Enter code: ${device.user_code}\n`);
		await openBrowser(device.verification_uri);

		const accessToken = await pollForToken(CLIENT_ID, device.device_code, device.interval);
		const auth = await readAuthFile();
		auth['github-copilot'] = {
			type: 'oauth',
			refresh: accessToken,
			access: accessToken,
			expires: 0
		};
		await writeAuthFile(auth);
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
};
