import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, destroySession, clearSession } from '$lib/server/session-manager';

// GET /api/sessions/:sessionId - Get session details
export const GET: RequestHandler = async ({ params }) => {
	const session = getSession(params.sessionId);
	if (!session) {
		throw error(404, 'Session not found');
	}

	return json({
		id: session.id,
		sandboxId: session.sandboxId,
		serverUrl: session.serverUrl,
		status: session.status,
		messages: session.messages,
		threadResources: session.threadResources,
		createdAt: session.createdAt.toISOString(),
		lastActivityAt: session.lastActivityAt.toISOString(),
		error: session.error
	});
};

// DELETE /api/sessions/:sessionId - Destroy session
export const DELETE: RequestHandler = async ({ params }) => {
	const session = getSession(params.sessionId);
	if (!session) {
		throw error(404, 'Session not found');
	}

	await destroySession(params.sessionId);
	return json({ success: true });
};

// POST /api/sessions/:sessionId/clear - Clear session messages
export const POST: RequestHandler = async ({ params, request }) => {
	const session = getSession(params.sessionId);
	if (!session) {
		throw error(404, 'Session not found');
	}

	const body = (await request.json()) as { action?: string };

	if (body.action === 'clear') {
		clearSession(params.sessionId);
		return json({ success: true });
	}

	throw error(400, 'Invalid action');
};
