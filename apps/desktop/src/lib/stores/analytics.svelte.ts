import posthog from 'posthog-js';
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

let initialized = false;

export function initAnalytics(): void {
	if (!browser || initialized) return;

	const posthogId = env.PUBLIC_POSTHOG_ID;
	if (!posthogId) {
		console.warn('PUBLIC_POSTHOG_ID is not set');
		return;
	}

	const analyticsHost = env.PUBLIC_ANALYTICS_HOST;
	if (!analyticsHost) {
		console.warn('PUBLIC_ANALYTICS_HOST is not set');
		return;
	}

	posthog.init(posthogId, {
		api_host: analyticsHost,
		ui_host: 'https://us.posthog.com',
		capture_pageview: true,
		capture_pageleave: true,
		persistence: 'localStorage'
	});

	initialized = true;
}

export function identifyUser(userId: string, properties?: Record<string, unknown>): void {
	if (!browser || !initialized) return;
	posthog.identify(userId, properties);
}

export function resetUser(): void {
	if (!browser || !initialized) return;
	posthog.reset();
}

export function trackEvent(event: string, properties?: Record<string, unknown>): void {
	if (!browser || !initialized) return;
	posthog.capture(event, {
		...properties,
		source: 'client'
	});
}

export const ClientAnalyticsEvents = {
	USER_SIGNED_IN: 'user_signed_in',
	USER_SIGNED_OUT: 'user_signed_out',
	CHECKOUT_BUTTON_CLICKED: 'checkout_button_clicked',
	API_KEY_CREATED: 'api_key_created',
	API_KEY_REVOKED: 'api_key_revoked',
	STREAM_CANCELLED: 'stream_cancelled',
	INSTANCE_WAKE_REQUESTED: 'instance_wake_requested',
	INSTANCE_STOP_REQUESTED: 'instance_stop_requested',
	INSTANCE_UPDATE_REQUESTED: 'instance_update_requested',
	INSTANCE_RESET_REQUESTED: 'instance_reset_requested'
} as const;
