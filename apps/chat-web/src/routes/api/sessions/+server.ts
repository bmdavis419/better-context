import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSession, getAllSessions } from '$lib/server/session-manager';

// GET /api/sessions - List all sessions
export const GET: RequestHandler = async () => {
	const sessions = getAllSessions();
	return json({
		sessions: sessions.map((s) => ({
			id: s.id,
			status: s.status,
			createdAt: s.createdAt.toISOString(),
			lastActivityAt: s.lastActivityAt.toISOString(),
			messageCount: s.messages.length,
			threadResources: s.threadResources,
			error: s.error
		}))
	});
};

// POST /api/sessions - Create a new session (lazy - no sandbox yet)
export const POST: RequestHandler = async () => {
	const session = createSession();
	return json({
		id: session.id,
		status: session.status,
		serverUrl: session.serverUrl,
		createdAt: session.createdAt.toISOString()
	});
};
