'use node';

import { PostHog } from 'posthog-node';
import { v } from 'convex/values';

import { internalAction } from './_generated/server';

let posthogClient: PostHog | null = null;

function getPostHog(): PostHog | null {
	if (!posthogClient) {
		const apiKey = process.env.POSTHOG_ID;
		if (!apiKey) {
			return null;
		}
		posthogClient = new PostHog(apiKey, {
			host: 'https://us.i.posthog.com',
			flushAt: 1,
			flushInterval: 0
		});
	}
	return posthogClient;
}

export const trackEvent = internalAction({
	args: {
		distinctId: v.string(),
		event: v.string(),
		properties: v.optional(v.any())
	},
	returns: v.null(),
	handler: async (_ctx, args) => {
		const posthog = getPostHog();
		if (!posthog) {
			return null;
		}
		posthog.capture({
			distinctId: args.distinctId,
			event: args.event,
			properties: {
				...(args.properties as Record<string, unknown> | undefined),
				environment: process.env.NODE_ENV ?? 'development',
				source: 'convex'
			}
		});
		return null;
	}
});

export const identifyUser = internalAction({
	args: {
		distinctId: v.string(),
		properties: v.optional(v.any())
	},
	returns: v.null(),
	handler: async (_ctx, args) => {
		const posthog = getPostHog();
		if (!posthog) {
			return null;
		}
		posthog.identify({
			distinctId: args.distinctId,
			properties: args.properties as Record<string, unknown> | undefined
		});
		return null;
	}
});
