/**
 * CLI API endpoints for btca remote commands.
 * These endpoints are authenticated via API key (like MCP) and provide
 * functionality needed by the CLI remote commands.
 */

import type { RequestHandler } from './$types';
import { jsonResponse } from '../../../lib/result/http';

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
