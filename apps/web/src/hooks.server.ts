import type { Handle } from '@sveltejs/kit';

const appendVary = (headers: Headers, value: string) => {
	const existing = headers.get('Vary');
	if (!existing) {
		headers.set('Vary', value);
		return;
	}

	const values = existing
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean);

	if (!values.includes(value)) {
		headers.set('Vary', [...values, value].join(', '));
	}
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	const headers = response.headers;

	// Minimal, low-risk security headers. Avoid CSP here since the app embeds third-party scripts (Clerk, PostHog).
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('X-Frame-Options', 'DENY');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

	// API responses should never be cached, especially since they depend on Authorization.
	if (event.url.pathname.startsWith('/api/')) {
		headers.set('Cache-Control', 'no-store');
		appendVary(headers, 'Authorization');
	}

	return response;
};
