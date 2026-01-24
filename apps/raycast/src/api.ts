import { getPreferenceValues } from '@raycast/api';
import { ResourcesResponseSchema, type ResourcesResponse } from './types';

const CONVEX_URL = 'https://greedy-partridge-784.convex.site';

interface Preferences {
	apiKey: string;
}

function getApiKey(): string {
	const preferences = getPreferenceValues<Preferences>();
	return preferences.apiKey;
}

function getHeaders(): HeadersInit {
	return {
		Authorization: `Bearer ${getApiKey()}`,
		'Content-Type': 'application/json'
	};
}

export async function fetchResources(): Promise<ResourcesResponse> {
	const response = await fetch(`${CONVEX_URL}/raycast/resources`, {
		method: 'GET',
		headers: getHeaders()
	});

	if (!response.ok) {
		const error = (await response.json().catch(() => ({ error: 'Unknown error' }))) as {
			error?: string;
			upgradeUrl?: string;
		};
		throw new ApiError(
			response.status,
			error.error || 'Failed to fetch resources',
			error.upgradeUrl
		);
	}

	const data = await response.json();
	return ResourcesResponseSchema.parse(data);
}

export async function askQuestion(question: string): Promise<Response> {
	const response = await fetch(`${CONVEX_URL}/raycast/ask`, {
		method: 'POST',
		headers: getHeaders(),
		body: JSON.stringify({ question })
	});

	if (!response.ok) {
		const error = (await response.json().catch(() => ({ error: 'Unknown error' }))) as {
			error?: string;
			upgradeUrl?: string;
		};
		throw new ApiError(response.status, error.error || 'Request failed', error.upgradeUrl);
	}

	return response;
}

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
		public upgradeUrl?: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}
