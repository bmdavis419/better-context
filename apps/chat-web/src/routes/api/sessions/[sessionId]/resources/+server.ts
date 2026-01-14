import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, getSessionResources, getDefaultResources } from '$lib/server/session-manager';

// GET /api/sessions/:sessionId/resources - Get available resources
export const GET: RequestHandler = async ({ params }) => {
	const session = getSession(params.sessionId);
	if (!session) {
		throw error(404, 'Session not found');
	}

	// For pending sessions, return default resources from config
	if (session.status === 'pending') {
		return json({ resources: getDefaultResources() });
	}

	if (session.status !== 'active') {
		throw error(400, `Session is not active: ${session.status}`);
	}

	try {
		const resources = await getSessionResources(params.sessionId);
		return json({ resources });
	} catch (err) {
		throw error(500, err instanceof Error ? err.message : 'Failed to get resources');
	}
};
