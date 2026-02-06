/**
 * POST /api/cli/wake - Wake the sandbox
 */

import { ConvexHttpClient } from 'convex/browser';
import { env } from '$env/dynamic/public';
import { api } from '../../../../convex/_generated/api';
import type { RequestHandler } from './$types';

const getConvexClient = () => new ConvexHttpClient(env.PUBLIC_CONVEX_URL!);

function extractApiKey(request: Request): string | null {
	const authHeader = request.headers.get('Authorization');
	if (!authHeader?.startsWith('Bearer ')) {
		return null;
	}
	return authHeader.slice(7) || null;
}

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

function errorResponse(message: string, status = 400): Response {
	return jsonResponse({ error: message }, status);
}

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = extractApiKey(request);
	if (!apiKey) {
		return errorResponse('Missing or invalid Authorization header', 401);
	}

	const convex = getConvexClient();

	try {
		const result = await convex.action(api.cli.wakeInstance, { apiKey });

		if (!result.ok) {
			return errorResponse(result.error, result.error.includes('valid') ? 401 : 400);
		}

		return jsonResponse({ serverUrl: result.serverUrl });
	} catch (err) {
		console.error('POST /api/cli/wake failed', err);
		return errorResponse('Internal error', 500);
	}
};
