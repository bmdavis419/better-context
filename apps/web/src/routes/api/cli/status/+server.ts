/**
 * GET /api/cli/status - Get instance and project status
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

	const convex = getConvexClient();
	const projectName = url.searchParams.get('project') ?? undefined;
	const result = await runConvexActionResult(() =>
		convex.action(api.cli.getInstanceStatus, {
			apiKey,
			project: projectName
		})
	);

	return handleConvexRouteResult(result, {
		mapErrorStatus: mapCliErrorStatus,
		onOk: (response) => response
	});
};
