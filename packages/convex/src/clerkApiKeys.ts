'use node';

import { createClerkClient } from '@clerk/backend';
import type { FunctionReference } from 'convex/server';
import { v } from 'convex/values';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action } from './_generated/server';
import { AnalyticsEvents } from './analyticsEvents';
import { instances } from './apiHelpers';

// Type for internal functions (will be auto-generated after first deploy)
type InternalClerkApiKeysQueries = {
	touchUsage: FunctionReference<
		'mutation',
		'internal',
		{
			clerkApiKeyId: string;
			clerkUserId: string;
			instanceId: Id<'instances'>;
			name?: string;
		},
		void
	>;
};

// Access internal functions for the queries module
const clerkApiKeysQueriesInternal = internal as unknown as {
	clerkApiKeysQueries: InternalClerkApiKeysQueries;
	analytics: {
		trackEvent: FunctionReference<
			'action',
			'internal',
			{ distinctId: string; event: string; properties: Record<string, unknown> },
			void
		>;
	};
};

const getClerkClient = (): ReturnType<typeof createClerkClient> | null => {
	const secretKey = process.env.CLERK_SECRET_KEY;
	if (!secretKey) {
		return null;
	}
	return createClerkClient({ secretKey });
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ApiKeyValidationResult =
	| {
			valid: true;
			clerkApiKeyId: string;
			clerkUserId: string;
			instanceId: Id<'instances'>;
	  }
	| {
			valid: false;
			error: string;
	  };

// ─────────────────────────────────────────────────────────────────────────────
// Actions (public API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate an API key using Clerk and return the associated instance.
 * This is the main entry point for API key validation.
 */
export const validate = action({
	args: { apiKey: v.string() },
	returns: v.union(
		v.object({
			valid: v.literal(true),
			clerkApiKeyId: v.string(),
			clerkUserId: v.string(),
			instanceId: v.id('instances')
		}),
		v.object({
			valid: v.literal(false),
			error: v.string()
		})
	),
	handler: async (ctx, args): Promise<ApiKeyValidationResult> => {
		const { apiKey } = args;

		// Verify with Clerk
		let clerkResult: { id: string; subject: string; name: string | null };
		try {
			const clerkClient = getClerkClient();
			if (!clerkClient) {
				return { valid: false, error: 'CLERK_SECRET_KEY environment variable is not set' };
			}
			clerkResult = await clerkClient.apiKeys.verify(apiKey);
		} catch (error) {
			// Clerk throws on invalid/revoked/expired keys
			const message = error instanceof Error ? error.message : 'Invalid API key';
			return { valid: false, error: message };
		}

		const clerkApiKeyId = clerkResult.id;
		const clerkUserId = clerkResult.subject;

		// Get instance by Clerk user ID (using internal query since we don't have auth context)
		const instance = await ctx.runQuery(instances.internalQueries.getByClerkIdInternal, {
			clerkId: clerkUserId
		});

		if (!instance) {
			return { valid: false, error: 'No instance found for this user' };
		}

		// Track usage (call the mutation in clerkApiKeysQueries module)
		await ctx.runMutation(clerkApiKeysQueriesInternal.clerkApiKeysQueries.touchUsage, {
			clerkApiKeyId,
			clerkUserId,
			instanceId: instance._id,
			name: clerkResult.name ?? undefined
		});

		// Track analytics asynchronously
		await ctx.scheduler.runAfter(0, clerkApiKeysQueriesInternal.analytics.trackEvent, {
			distinctId: clerkUserId,
			event: AnalyticsEvents.API_KEY_USED,
			properties: {
				instanceId: instance._id,
				apiKeyId: clerkApiKeyId
			}
		});

		return {
			valid: true,
			clerkApiKeyId,
			clerkUserId,
			instanceId: instance._id
		};
	}
});
