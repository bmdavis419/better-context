/**
 * GET /api/cli/questions - List MCP questions for a project
 */

import { ConvexHttpClient } from 'convex/browser';
import { env } from '$env/dynamic/public';
import { api } from '../../../../convex/_generated/api';
import type { RequestHandler } from './$types';
import {
	extractApiKey,
	handleConvexRouteResult,
	jsonError,
	mapCliErrorStatus,
	runConvexActionResult
} from '../../../../lib/result/http';

const getConvexClient = () => new ConvexHttpClient(env.PUBLIC_CONVEX_URL!);

export const GET: RequestHandler = async ({ request, url }) => {
	const apiKey = extractApiKey(request);
	if (!apiKey) {
		return jsonError(401, 'Missing or invalid Authorization header');
	}

	const projectName = url.searchParams.get('project') ?? undefined;
	if (!projectName) {
		return jsonError(400, 'Project name required (use ?project=name)');
	}

	const convex = getConvexClient();
	const result = await runConvexActionResult(() =>
		convex.action(api.cli.listQuestions, {
			apiKey,
			project: projectName
		})
	);

	return handleConvexRouteResult(result, {
		mapErrorStatus: (error) => (error.includes('not found') ? 404 : mapCliErrorStatus(error)),
		onOk: (response) => ({
			questions: response.questions
		})
	});
};
