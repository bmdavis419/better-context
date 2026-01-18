import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { AutumnService } from '$lib/server/autumn';

const UserSchema = z.object({
	userId: z.string()
});

function getConvexClient() {
	return new ConvexHttpClient(PUBLIC_CONVEX_URL);
}

async function getUser(userId: string) {
	const convex = getConvexClient();
	const user = await convex.query(api.users.get, { id: userId as Id<'instances'> });
	if (!user) {
		throw error(404, 'User not found');
	}
	return user;
}

export const remoteGetBillingSummary = command('unchecked', async (input) => {
	const parsed = UserSchema.safeParse(input);
	if (!parsed.success) {
		throw error(400, 'Invalid user');
	}

	const instance = await getUser(parsed.data.userId);
	const autumn = AutumnService.get();
	return await autumn.getBillingSummary({
		clerkId: instance.clerkId,
		email: null,
		name: null
	});
});

export const remoteCreateCheckoutSession = command('unchecked', async (input) => {
	const parsed = UserSchema.safeParse(input);
	if (!parsed.success) {
		throw error(400, 'Invalid user');
	}

	const instance = await getUser(parsed.data.userId);
	const autumn = AutumnService.get();
	const baseUrl = getRequestEvent().url.origin;
	return await autumn.createCheckoutSession({
		user: {
			clerkId: instance.clerkId,
			email: null,
			name: null
		},
		baseUrl
	});
});

export const remoteCreateBillingPortalSession = command('unchecked', async (input) => {
	const parsed = UserSchema.safeParse(input);
	if (!parsed.success) {
		throw error(400, 'Invalid user');
	}

	const instance = await getUser(parsed.data.userId);
	const autumn = AutumnService.get();
	const baseUrl = getRequestEvent().url.origin;
	return await autumn.createBillingPortalSession({
		user: {
			clerkId: instance.clerkId,
			email: null,
			name: null
		},
		baseUrl
	});
});
