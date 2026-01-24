import type { ActionCtx } from './_generated/server';
import { api } from './_generated/api';
import type { Doc } from './_generated/dataModel';

export type RaycastAuthResult = {
	instance: Doc<'instances'>;
	apiKey: {
		_id: Doc<'apiKeys'>['_id'];
		instanceId: Doc<'apiKeys'>['instanceId'];
		name: string;
		status: 'active' | 'revoked';
	};
};

export type RaycastAuthError = {
	status: number;
	message: string;
};

export async function authenticateRaycastRequest(
	ctx: ActionCtx,
	request: Request
): Promise<RaycastAuthResult | RaycastAuthError> {
	const authHeader = request.headers.get('Authorization');

	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return { status: 401, message: 'Missing or invalid Authorization header' };
	}

	const apiKeyValue = authHeader.slice(7); // Remove 'Bearer '

	if (!apiKeyValue) {
		return { status: 401, message: 'API key is required' };
	}

	// Look up the API key
	const apiKey = await ctx.runQuery(api.apiKeys.getByKey, { key: apiKeyValue });

	if (!apiKey) {
		return { status: 401, message: 'Invalid API key' };
	}

	// Check if key is active
	if (apiKey.status !== 'active') {
		return { status: 401, message: 'API key is inactive' };
	}

	// Get the associated instance
	const instance = await ctx.runQuery(api.instances.queries.get, {
		id: apiKey.instanceId
	});

	if (!instance) {
		return { status: 404, message: 'Instance not found' };
	}

	return { instance, apiKey };
}

export function isAuthError(
	result: RaycastAuthResult | RaycastAuthError
): result is RaycastAuthError {
	return 'status' in result && 'message' in result && !('instance' in result);
}
