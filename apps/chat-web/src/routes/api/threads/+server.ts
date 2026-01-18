import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { z } from 'zod';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// Request body schema for creating a thread
const CreateThreadRequestSchema = z.object({
	userId: z.string()
});

function getConvexClient(): ConvexHttpClient {
	return new ConvexHttpClient(PUBLIC_CONVEX_URL);
}

// POST /api/threads - Create a new thread
export const POST: RequestHandler = async ({ request }) => {
	// Validate request body
	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch (e) {
		throw error(400, 'Invalid request body: could not parse JSON');
	}

	const parseResult = CreateThreadRequestSchema.safeParse(rawBody);
	if (!parseResult.success) {
		const issues = parseResult.error.issues
			.map((i) => `${i.path.join('.')}: ${i.message}`)
			.join('; ');
		throw error(400, `Invalid request: ${issues}`);
	}

	const { userId } = parseResult.data;
	const convex = getConvexClient();

	try {
		// Create the thread in Convex
		const threadId = await convex.mutation(api.threads.create, {
			userId: userId as Id<'instances'>
		});

		return json({ threadId });
	} catch (err) {
		console.error('Failed to create thread:', err);
		throw error(500, err instanceof Error ? err.message : 'Failed to create thread');
	}
};
