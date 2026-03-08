import type { Clerk } from '@clerk/clerk-js';
import type { OAuthScope, SessionResource, UserResource } from '@clerk/types';
import type { Id } from '@btca/convex/dataModel';

// Auth state
let clerk = $state<Clerk | null>(null);
let isLoaded = $state(false);
let isSignedIn = $state(false);
let user = $state<UserResource | null>(null);
let session = $state<SessionResource | null>(null);
let instanceId = $state<Id<'instances'> | null>(null);

/**
 * Set the Clerk instance (alias: setAuthState)
 */
export function setClerk(instance: Clerk) {
	clerk = instance;
	isLoaded = instance.loaded ?? false;
	isSignedIn = !!instance.user;
	user = instance.user ?? null;
	session = instance.session ?? null;

	// Listen for auth changes
	instance.addListener(() => {
		isLoaded = instance.loaded ?? false;
		isSignedIn = !!instance.user;
		user = instance.user ?? null;
		session = instance.session ?? null;
	});
}

// Alias for setClerk
export const setAuthState = setClerk;

/**
 * Set the instance ID
 */
export function setInstanceId(id: Id<'instances'> | null) {
	instanceId = id;
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
		get session() {
			return session;
		},
		get hasSession() {
			return !!session;
		},
		get instanceId() {
			return instanceId;
		},
		set instanceId(id: Id<'instances'> | null) {
			instanceId = id;
		},
		async getToken(options?: { template?: string }) {
			if (!clerk?.session) return null;
			return clerk.session.getToken(options);
		}
	} as {
		readonly clerk: Clerk | null;
		readonly isLoaded: boolean;
		readonly isSignedIn: boolean;
		readonly user: UserResource | null;
		readonly session: SessionResource | null;
		readonly hasSession: boolean;
		instanceId: Id<'instances'> | null;
		getToken: (options?: { template?: string }) => Promise<string | null>;
	};
}

/**
 * Sign out the user
 */
export async function signOut() {
	if (clerk) {
		await clerk.signOut();
		session = null;
		instanceId = null;
	}
}

/**
 * Open the sign-in modal
 */
export function openSignIn() {
	if (clerk) {
		clerk.openSignIn({ redirectUrl: '/app' });
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
export function openUserProfile(additionalOAuthScopes?: Partial<Record<'github', OAuthScope[]>>) {
	if (clerk) {
		clerk.openUserProfile(additionalOAuthScopes ? { additionalOAuthScopes } : undefined);
	}
}

export async function reconnectGitHub(scopes: OAuthScope[] = ['repo']) {
	const githubAccount = user?.externalAccounts.find((account) => account.provider === 'github');
	if (!githubAccount) return false;

	try {
		await githubAccount.reauthorize({
			additionalScopes: scopes,
			redirectUrl: globalThis.location?.href
		});
		return true;
	} catch (error) {
		console.error('Failed to reauthorize GitHub account:', error);
		return false;
	}
}
