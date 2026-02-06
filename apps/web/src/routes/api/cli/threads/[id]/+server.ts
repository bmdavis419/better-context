/**
 * GET /api/cli/threads/:id - Get thread with messages
 */

import { ConvexHttpClient } from 'convex/browser';
import { env } from '$env/dynamic/public';
import { api } from '../../../../../convex/_generated/api';
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

export const GET: RequestHandler = async ({ request, params }) => {
	const apiKey = extractApiKey(request);
	if (!apiKey) {
		return errorResponse('Missing or invalid Authorization header', 401);
	}

	const threadId = params.id;
	if (!threadId) {
		return errorResponse('Thread ID required', 400);
	}

	const convex = getConvexClient();

	try {
		const result = await convex.action(api.cli.getThread, {
			apiKey,
			threadId
		});

		if (!result.ok) {
			return errorResponse(
				result.error,
				result.error.includes('not found') ? 404 : result.error.includes('valid') ? 401 : 400
			);
		}

		return jsonResponse({ thread: result.thread, messages: result.messages });
	} catch (err) {
		console.error('GET /api/cli/threads/:id failed', err);
		return errorResponse('Internal error', 500);
	}
};
