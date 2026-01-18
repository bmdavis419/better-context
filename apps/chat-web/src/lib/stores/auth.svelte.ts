import type { Clerk } from '@clerk/clerk-js';
import type { UserResource } from '@clerk/types';
import type { Id } from '../../convex/_generated/dataModel';

// Auth state
let clerk = $state<Clerk | null>(null);
let isLoaded = $state(false);
let isSignedIn = $state(false);
let user = $state<UserResource | null>(null);
let convexUserId = $state<Id<'instances'> | null>(null);

/**
 * Set the Clerk instance (alias: setAuthState)
 */
export function setClerk(instance: Clerk) {
	clerk = instance;
	isLoaded = instance.loaded ?? false;
	isSignedIn = !!instance.user;
	user = instance.user ?? null;

	// Listen for auth changes
	instance.addListener((resources) => {
		isSignedIn = !!resources.user;
		user = resources.user ?? null;
	});
}

// Alias for setClerk
export const setAuthState = setClerk;

/**
 * Set the Convex user ID
 */
export function setConvexUserId(id: Id<'instances'> | null) {
	convexUserId = id;
}

/**
 * Get the current auth state
 */
export function getAuthState() {
	return {
		get clerk() {
			return clerk;
		},
		get isLoaded() {
			return isLoaded;
		},
		get isSignedIn() {
			return isSignedIn;
		},
		get user() {
			return user;
		},
		get convexUserId() {
			return convexUserId;
		},
		set convexUserId(id: Id<'instances'> | null) {
			convexUserId = id;
		}
	};
}

/**
 * Sign out the user
 */
export async function signOut() {
	if (clerk) {
		await clerk.signOut();
		convexUserId = null;
	}
}

/**
 * Open the sign-in modal
 */
export function openSignIn(redirectUrl?: string) {
	if (clerk) {
		clerk.openSignIn({ redirectUrl });
	}
}

/**
 * Open the sign-up modal
 */
export function openSignUp(redirectUrl?: string) {
	if (clerk) {
		clerk.openSignUp({ redirectUrl });
	}
}

/**
 * Open the user profile modal
 */
export function openUserProfile() {
	if (clerk) {
		clerk.openUserProfile();
	}
}
