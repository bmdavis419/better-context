/**
 * POST /api/cli/wake - Wake the sandbox
 */

import { ConvexHttpClient } from 'convex/browser';
import { env } from '$env/dynamic/public';
import { api } from '../../../../convex/_generated/api';
import type { RequestHandler } from './$types';
import {
	extractApiKey,
	handleConvexRouteResult,
	jsonError,
	runConvexActionResult
} from '../../../../lib/result/http';

const getConvexClient = () => new ConvexHttpClient(env.PUBLIC_CONVEX_URL!);

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = extractApiKey(request);
	if (!apiKey) {
		return jsonError(401, 'Missing or invalid Authorization header');
	}

	const convex = getConvexClient();
	const result = await runConvexActionResult(() => convex.action(api.cli.wakeInstance, { apiKey }));

	return handleConvexRouteResult(result, {
		mapErrorStatus: (error) => (error.includes('valid') ? 401 : 400),
		onOk: (response) => ({ serverUrl: response.serverUrl })
	});
};
