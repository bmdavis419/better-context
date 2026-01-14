import { PUBLIC_CLERK_PUBLISHABLE_KEY } from '$env/static/public';
import { Clerk } from '@clerk/clerk-js';

let clerkInstance: Clerk | null = null;
let initPromise: Promise<Clerk> | null = null;

/**
 * Initialize and load Clerk
 * Returns a singleton instance
 */
export async function initializeClerk(): Promise<Clerk> {
	if (clerkInstance?.loaded) {
		return clerkInstance;
	}

	if (initPromise) {
		return initPromise;
	}

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
