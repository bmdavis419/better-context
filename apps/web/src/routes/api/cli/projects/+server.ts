/**
 * GET /api/cli/projects - List projects
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

export const GET: RequestHandler = async ({ request }) => {
	const apiKey = extractApiKey(request);
	if (!apiKey) {
		return jsonError(401, 'Missing or invalid Authorization header');
	}

	const convex = getConvexClient();
	const result = await runConvexActionResult(() => convex.action(api.cli.listProjects, { apiKey }));

	return handleConvexRouteResult(result, {
		mapErrorStatus: mapCliErrorStatus,
		onOk: (response) => ({
			projects: response.projects
		})
	});
};
