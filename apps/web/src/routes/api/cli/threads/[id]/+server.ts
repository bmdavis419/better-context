/**
 * GET /api/cli/threads/:id - Get thread with messages
 */

import { ConvexHttpClient } from 'convex/browser';
import { env } from '$env/dynamic/public';
import { api } from '../../../../../convex/_generated/api';
import type { RequestHandler } from './$types';
import {
	extractApiKey,
	handleConvexRouteResult,
	jsonError,
	mapCliErrorStatus,
	runConvexActionResult
} from '../../../../../lib/result/http';

const getConvexClient = () => new ConvexHttpClient(env.PUBLIC_CONVEX_URL!);

export const GET: RequestHandler = async ({ request, params }) => {
	const apiKey = extractApiKey(request);
	if (!apiKey) {
		return jsonError(401, 'Missing or invalid Authorization header');
	}

	const threadId = params.id;
	if (!threadId) {
		return jsonError(400, 'Thread ID required');
	}

	const convex = getConvexClient();
	const result = await runConvexActionResult(() =>
		convex.action(api.cli.getThread, {
			apiKey,
			threadId
		})
	);

	return handleConvexRouteResult(result, {
		mapErrorStatus: (error) => (error.includes('not found') ? 404 : mapCliErrorStatus(error)),
		onOk: (response) => ({
			thread: response.thread,
			messages: response.messages
		})
	});
};
