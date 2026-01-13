import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSession, getAllSessions, getSession } from '$lib/server/session-manager';

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

// POST /api/sessions - Create a new session
export const POST: RequestHandler = async () => {
	try {
		const session = await createSession();
		return json({
			id: session.id,
			status: session.status,
			serverUrl: session.serverUrl,
			createdAt: session.createdAt.toISOString()
		});
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to create session' },
			{ status: 500 }
		);
	}
};
