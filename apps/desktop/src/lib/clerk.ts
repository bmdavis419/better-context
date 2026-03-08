import { PUBLIC_CLERK_PUBLISHABLE_KEY } from '$env/static/public';
import { Clerk } from '@clerk/clerk-js';
import { dev } from '$app/environment';

let clerkInstance: Clerk | null = null;
let initPromise: Promise<Clerk> | null = null;

function suppressBeforeUnloadInDev() {
	if (!dev || typeof window === 'undefined') return;

	const originalAddEventListener = window.addEventListener.bind(window);
	window.addEventListener = ((
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions
	) => {
		if (type === 'beforeunload') return;
		return originalAddEventListener(type, listener, options);
	}) as typeof window.addEventListener;

	Object.defineProperty(window, 'onbeforeunload', {
		set: () => {},
		get: () => null
	});
}

export async function initializeClerk(): Promise<Clerk> {
	if (clerkInstance?.loaded) {
		return clerkInstance;
	}

	if (initPromise) {
		return initPromise;
	}

	suppressBeforeUnloadInDev();

	initPromise = (async () => {
		clerkInstance = new Clerk(PUBLIC_CLERK_PUBLISHABLE_KEY);
		await clerkInstance.load();

		return clerkInstance;
	})();

	return initPromise;
}

/**
 * Get the Clerk instance (must be initialized first)
 */
export function getClerk(): Clerk | null {
	return clerkInstance;
}

/**
 * Check if Clerk is loaded
 */
export function isClerkLoaded(): boolean {
	return clerkInstance?.loaded ?? false;
}
