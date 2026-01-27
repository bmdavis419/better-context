/**
 * GET /api/cli/status - Get instance and project status
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

export const GET: RequestHandler = async ({ request, url }) => {
	const apiKey = extractApiKey(request);
	if (!apiKey) {
		return errorResponse('Missing or invalid Authorization header', 401);
	}

	const convex = getConvexClient();
	const projectName = url.searchParams.get('project') ?? undefined;

	try {
		const result = await convex.action(api.cli.getInstanceStatus, {
			apiKey,
			project: projectName
		});

		if (!result.ok) {
			return errorResponse(result.error, result.error.includes('valid') ? 401 : 400);
		}

		return jsonResponse(result);
	} catch (err) {
		return errorResponse(err instanceof Error ? err.message : 'Internal error', 500);
	}
};
