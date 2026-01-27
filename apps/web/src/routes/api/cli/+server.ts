/**
 * CLI API endpoints for btca remote commands.
 * These endpoints are authenticated via API key (like MCP) and provide
 * functionality needed by the CLI remote commands.
 */

import { ConvexHttpClient } from 'convex/browser';
import { env } from '$env/dynamic/public';
import { api } from '../../../convex/_generated/api';
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

/**
 * GET /api/cli - Health check and info
 */
export const GET: RequestHandler = async () => {
	return jsonResponse({
		name: 'btca-cli-api',
		version: '1.0.0',
		endpoints: [
			'GET /api/cli/status',
			'POST /api/cli/wake',
			'GET /api/cli/threads',
			'GET /api/cli/threads/:id',
			'GET /api/cli/projects',
			'GET /api/cli/questions'
		]
	});
};
