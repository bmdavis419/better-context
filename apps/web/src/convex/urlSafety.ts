const isIpv4 = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host);

const parseIpv4 = (host: string) => {
	const parts = host.split('.').map((p) => Number.parseInt(p, 10));
	if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) return null;
	return parts as [number, number, number, number];
};

const isPrivateIpv4 = (host: string) => {
	const ip = parseIpv4(host);
	if (!ip) return false;
	const [a, b] = ip;

	if (a === 0) return true;
	if (a === 10) return true;
	if (a === 127) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;

	return false;
};

const isPrivateIpv6 = (host: string) => {
	const normalized = host.toLowerCase().split('%')[0] ?? '';
	if (!normalized) return false;
	if (normalized === '::1') return true; // loopback
	if (normalized.startsWith('fe80:')) return true; // link-local
	if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local (fc00::/7)
	return false;
};

const isPrivateHostname = (host: string) => {
	const hostname = host.toLowerCase();
	if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true;
	if (hostname.endsWith('.local')) return true;
	if (isIpv4(hostname) && isPrivateIpv4(hostname)) return true;
	if (hostname.includes(':') && isPrivateIpv6(hostname)) return true;
	return false;
};

export const assertSafeServerUrl = (raw: string) => {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('Invalid server URL');
	}

	if (url.username || url.password) {
		throw new Error('Server URL must not include credentials');
	}

	const protocol = url.protocol;
	const isProd = (process.env.NODE_ENV ?? 'production') === 'production';
	if (protocol !== 'https:' && !(protocol === 'http:' && !isProd)) {
		throw new Error('Insecure server URL protocol');
	}

	if (isPrivateHostname(url.hostname)) {
		throw new Error('Unsafe server URL hostname');
	}

	return url.origin;
};
