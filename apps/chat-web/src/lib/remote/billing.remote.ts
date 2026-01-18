import type { FunctionReference } from 'convex/server';
import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { ConvexHttpClient } from 'convex/browser';
import { z } from 'zod';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

const UserSchema = z.object({
	userId: z.string()
});

type QueryRef = FunctionReference<'query', 'public'>;
type NestedApi = typeof api & {
	'instances/queries': Record<string, QueryRef>;
};

const instanceQueries = (api as NestedApi)['instances/queries'];
const usageActions = api.usage;

function getConvexClient() {
	return new ConvexHttpClient(PUBLIC_CONVEX_URL);
}

async function getInstance(userId: string) {
	const convex = getConvexClient();
	const instance = await convex.query(instanceQueries.get, {
		id: userId as Id<'instances'>
	});
	if (!instance) {
		throw error(404, 'User not found');
	}
	return instance;
}

export const remoteGetBillingSummary = command('unchecked', async (input) => {
	const parsed = UserSchema.safeParse(input);
	if (!parsed.success) {
		throw error(400, 'Invalid user');
	}

	const instance = await getInstance(parsed.data.userId);
	const convex = getConvexClient();
	return await convex.action(usageActions.getBillingSummary, {
		instanceId: instance._id
	});
});

export const remoteCreateCheckoutSession = command('unchecked', async (input) => {
	const parsed = UserSchema.safeParse(input);
	if (!parsed.success) {
		throw error(400, 'Invalid user');
	}

	const instance = await getInstance(parsed.data.userId);
	const convex = getConvexClient();
	const baseUrl = getRequestEvent().url.origin;
	return await convex.action(usageActions.createCheckoutSession, {
		instanceId: instance._id,
		baseUrl
	});
});

export const remoteCreateBillingPortalSession = command('unchecked', async (input) => {
	const parsed = UserSchema.safeParse(input);
	if (!parsed.success) {
		throw error(400, 'Invalid user');
	}

	const instance = await getInstance(parsed.data.userId);
	const convex = getConvexClient();
	const baseUrl = getRequestEvent().url.origin;
	return await convex.action(usageActions.createBillingPortalSession, {
		instanceId: instance._id,
		baseUrl
	});
});
