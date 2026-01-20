import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

export type AuthInfo =
	| {
			type: 'oauth';
			refresh: string;
			access: string;
			expires: number;
			accountId?: string;
		}
	| {
			type: 'api';
			key: string;
		};

const getDataHome = (): string => {
	if (process.env.XDG_DATA_HOME) return process.env.XDG_DATA_HOME;
	if (process.platform === 'win32') {
		return process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
	}
	return path.join(os.homedir(), '.local', 'share');
};

const getAuthPath = (): string => path.join(getDataHome(), 'opencode', 'auth.json');

const ensureAuthDir = async () => {
	await fs.mkdir(path.dirname(getAuthPath()), { recursive: true });
};

const readAll = async (): Promise<Record<string, AuthInfo>> => {
	const file = Bun.file(getAuthPath());
	const data = await file.json().catch(() => ({})) as Record<string, AuthInfo>;
	return data;
};

export const setAuth = async (provider: string, info: AuthInfo) => {
	await ensureAuthDir();
	const data = await readAll();
	await Bun.write(getAuthPath(), JSON.stringify({ ...data, [provider]: info }, null, 2));
	try {
		await fs.chmod(getAuthPath(), 0o600);
	} catch {
		// ignore permissions on non-posix systems
	}
};

export const getAuth = async (provider: string): Promise<AuthInfo | undefined> => {
	const data = await readAll();
	return data[provider];
};

export const listAuth = async (): Promise<Record<string, AuthInfo>> => readAll();
