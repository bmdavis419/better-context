/**
 * GET /api/cli/questions - List MCP questions for a project
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

	const projectName = url.searchParams.get('project');
	if (!projectName) {
		return errorResponse('Project name required (use ?project=name)', 400);
	}

	const convex = getConvexClient();

	try {
		const result = await convex.action(api.cli.listQuestions, {
			apiKey,
			project: projectName
		});

		if (!result.ok) {
			return errorResponse(
				result.error,
				result.error.includes('not found') ? 404 : result.error.includes('valid') ? 401 : 400
			);
		}

		return jsonResponse({ questions: result.questions });
	} catch (err) {
		console.error('GET /api/cli/questions failed', err);
		return errorResponse('Internal error', 500);
	}
};
