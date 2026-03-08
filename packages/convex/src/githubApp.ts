'use node';

import {
	WebAuthError,
	WebConfigMissingError,
	WebUnhandledError,
	WebValidationError
} from './lib/result/errors';

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const GITHUB_APP_JWT_LIFETIME_SECONDS = 9 * 60;

export type GitHubRepoRef = {
	owner: string;
	repo: string;
};

export type GitHubAppInstallationSnapshot = {
	installationId: number;
	accountLogin: string;
	accountType: 'User' | 'Organization';
	targetType: 'User' | 'Organization';
	repositorySelection: 'all' | 'selected';
	repositoryIds: number[];
	repositoryNames: string[];
	contentsPermission?: string;
	metadataPermission?: string;
	htmlUrl?: string;
	status: 'active' | 'suspended';
	connectedAt: number;
	lastSyncedAt: number;
	suspendedAt?: number;
};

type GitHubAppInfo = {
	slug: string;
	name?: string;
	html_url?: string;
};

type GitHubInstallationAccount = {
	login: string;
	type: 'User' | 'Organization';
};

type GitHubInstallationResponse = {
	id: number;
	account: GitHubInstallationAccount | null;
	target_type?: 'User' | 'Organization';
	repository_selection: 'all' | 'selected';
	permissions?: Record<string, string>;
	html_url?: string;
	suspended_at?: string | null;
};

type GitHubInstallationRepositoriesResponse = {
	repositories: Array<{
		id: number;
		full_name: string;
		private: boolean;
		default_branch: string;
	}>;
};

type GitHubRepoResponse = {
	id: number;
	full_name: string;
	private: boolean;
	default_branch: string;
};

let cachedPrivateKey: CryptoKey | null = null;
let cachedAppInfo: GitHubAppInfo | null = null;

const textEncoder = new TextEncoder();

const requireEnv = (name: string) => {
	const value = process.env[name];
	if (!value) {
		throw new WebConfigMissingError({
			message: `${name} is not set in the Convex environment`,
			config: name
		});
	}
	return value;
};

const normalizePrivateKey = (value: string) => value.replace(/\\n/g, '\n').trim();

const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const stringToBase64 = (value: string) => bytesToBase64(textEncoder.encode(value));

const base64UrlEncode = (value: string | Uint8Array) =>
	(typeof value === 'string' ? stringToBase64(value) : bytesToBase64(value))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '');

const parsePem = (pem: string) => {
	const contents = pem.replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----|\s+/g, '');
	const normalized = contents.replace(/-/g, '+').replace(/_/g, '/');
	const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
	const binary = atob(`${normalized}${padding}`);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const getGitHubHeaders = (token?: string) => ({
	Accept: 'application/vnd.github+json',
	'User-Agent': 'btca-web',
	'X-GitHub-Api-Version': GITHUB_API_VERSION,
	...(token ? { Authorization: `Bearer ${token}` } : {})
});

const importPrivateKey = async () => {
	if (cachedPrivateKey) {
		return cachedPrivateKey;
	}

	const pem = normalizePrivateKey(requireEnv('GITHUB_APP_PRIVATE_KEY'));
	cachedPrivateKey = await crypto.subtle.importKey(
		'pkcs8',
		parsePem(pem),
		{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
		false,
		['sign']
	);

	return cachedPrivateKey;
};

const createGitHubAppJwt = async () => {
	const privateKey = await importPrivateKey();
	const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
	const nowSeconds = Math.floor(Date.now() / 1000);
	const payload = base64UrlEncode(
		JSON.stringify({
			iat: nowSeconds - 30,
			exp: nowSeconds + GITHUB_APP_JWT_LIFETIME_SECONDS,
			iss: requireEnv('GITHUB_APP_ID')
		})
	);
	const unsignedToken = `${header}.${payload}`;
	const signature = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		privateKey,
		textEncoder.encode(unsignedToken)
	);
	return `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`;
};

const githubRequest = async (
	path: string,
	init: RequestInit = {},
	token?: string
): Promise<Response> =>
	fetch(`${GITHUB_API_BASE_URL}${path}`, {
		...init,
		headers: {
			...getGitHubHeaders(token),
			...(init.headers ?? {})
		}
	});

const appRequest = async (path: string, init: RequestInit = {}) =>
	githubRequest(path, init, await createGitHubAppJwt());

const parseJson = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const assertOk = async (response: Response, context: string) => {
	if (response.ok) return;
	const details = await response.text().catch(() => '');
	throw new WebUnhandledError({
		message: `${context} failed with status ${response.status}${details ? `: ${details}` : ''}`
	});
};

export const parseGitHubRepoRef = (url: string): GitHubRepoRef | null => {
	try {
		const parsed = new URL(url);
		if (parsed.hostname.toLowerCase() !== 'github.com') return null;
		const [owner, repo] = parsed.pathname
			.split('/')
			.filter(Boolean)
			.slice(0, 2)
			.map((segment) => segment.replace(/\.git$/, ''));
		if (!owner || !repo) return null;
		return { owner, repo };
	} catch {
		return null;
	}
};

export const getRepoFullName = (repoRef: GitHubRepoRef) => `${repoRef.owner}/${repoRef.repo}`;

export const fetchGitHubRepo = async (repoRef: GitHubRepoRef, token?: string) =>
	githubRequest(`/repos/${repoRef.owner}/${repoRef.repo}`, {}, token);

export const ensureGitHubBranch = async (
	repoRef: GitHubRepoRef,
	branch: string,
	token?: string
) => {
	const response = await githubRequest(
		`/repos/${repoRef.owner}/${repoRef.repo}/branches/${encodeURIComponent(branch)}`,
		{},
		token
	);

	if (response.ok) return;
	if (response.status === 404) {
		throw new WebValidationError({
			message: `Branch "${branch}" was not found on ${repoRef.owner}/${repoRef.repo}`,
			field: 'branch'
		});
	}

	const details = await response.text().catch(() => '');
	throw new WebUnhandledError({
		message: `GitHub branch lookup failed with status ${response.status}${details ? `: ${details}` : ''}`
	});
};

export const getAppInfo = async () => {
	if (cachedAppInfo) {
		return cachedAppInfo;
	}

	requireEnv('GITHUB_APP_CLIENT_ID');
	requireEnv('GITHUB_APP_CLIENT_SECRET');
	const response = await appRequest('/app');
	await assertOk(response, 'GitHub app lookup');
	cachedAppInfo = await parseJson<GitHubAppInfo>(response);
	return cachedAppInfo;
};

export const getInstallationSnapshot = async (
	installationId: number
): Promise<GitHubAppInstallationSnapshot | null> => {
	const response = await appRequest(`/app/installations/${installationId}`);
	if (response.status === 404) {
		return null;
	}
	await assertOk(response, 'GitHub installation lookup');
	const installation = await parseJson<GitHubInstallationResponse>(response);

	if (!installation.account?.login || !installation.account.type) {
		throw new WebUnhandledError({
			message: `GitHub installation ${installationId} is missing account metadata`
		});
	}

	const connectedAt = Date.now();
	const lastSyncedAt = connectedAt;
	const repositorySelection = installation.repository_selection;
	const repositoryNames: string[] = [];
	const repositoryIds: number[] = [];

	if (repositorySelection === 'selected') {
		const token = await createInstallationToken(installationId);
		let nextUrl = `${GITHUB_API_BASE_URL}/installation/repositories?per_page=100`;
		while (nextUrl) {
			const pageResponse = await fetch(nextUrl, {
				headers: getGitHubHeaders(token)
			});
			await assertOk(pageResponse, 'GitHub installation repository listing');
			const page = await parseJson<GitHubInstallationRepositoriesResponse>(pageResponse);
			for (const repository of page.repositories) {
				repositoryIds.push(repository.id);
				repositoryNames.push(repository.full_name);
			}

			const linkHeader = pageResponse.headers.get('link') ?? '';
			const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
			nextUrl = nextMatch?.[1] ?? '';
		}
	}

	return {
		installationId,
		accountLogin: installation.account.login,
		accountType: installation.account.type,
		targetType: installation.target_type ?? installation.account.type,
		repositorySelection,
		repositoryIds,
		repositoryNames,
		contentsPermission: installation.permissions?.contents,
		metadataPermission: installation.permissions?.metadata,
		htmlUrl: installation.html_url,
		status: installation.suspended_at ? 'suspended' : 'active',
		connectedAt,
		lastSyncedAt,
		suspendedAt: installation.suspended_at
			? new Date(installation.suspended_at).getTime()
			: undefined
	};
};

export const createInstallationToken = async (installationId: number) => {
	const response = await appRequest(`/app/installations/${installationId}/access_tokens`, {
		method: 'POST'
	});

	if (response.status === 404) {
		throw new WebAuthError({
			message: 'The GitHub App installation no longer exists. Reconnect GitHub and try again.',
			code: 'UNAUTHORIZED'
		});
	}

	await assertOk(response, 'GitHub installation token creation');
	const body = await parseJson<{ token?: string }>(response);
	if (!body.token) {
		throw new WebUnhandledError({
			message: `GitHub installation ${installationId} did not return an access token`
		});
	}

	return body.token;
};

export const resolveAccessibleRepo = async (installationId: number, repoRef: GitHubRepoRef) => {
	const token = await createInstallationToken(installationId);
	const response = await fetchGitHubRepo(repoRef, token);
	if (response.status === 404) {
		return null;
	}
	await assertOk(response, 'GitHub repository lookup');
	return {
		token,
		repo: await parseJson<GitHubRepoResponse>(response)
	};
};
