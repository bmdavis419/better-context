<script lang="ts">
	import './layout.css';
	import {
		Bot,
		Moon,
		Sun,
		Github,
		User,
		LogOut,
		Settings,
		Loader2,
		BarChart3,
		CreditCard,
		Key
	} from '@lucide/svelte';
	import { setThemeStore } from '$lib/stores/theme.svelte';
	import { onMount } from 'svelte';
	import { initializeClerk, getClerk } from '$lib/clerk';
	import { setupConvex, useConvexClient } from 'convex-svelte';
	import { untrack } from 'svelte';
	import {
		setAuthState,
		getAuthState,
		setInstanceId,
		signOut,
		openSignIn,
		openUserProfile
	} from '$lib/stores/auth.svelte';
	import { setBillingStore } from '$lib/stores/billing.svelte';
	import { setInstanceStore, getInstanceStore } from '$lib/stores/instance.svelte';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';

	let { children } = $props();

	setupConvex(PUBLIC_CONVEX_URL);

	const client = useConvexClient();

	let clerkInitPromise: Promise<void> | null = null;

	const getClerkAuthToken = async () => {
		if (clerkInitPromise) {
			await clerkInitPromise;
		}
		const clerk = getClerk();
		if (!clerk?.loaded || !clerk.session) return null;
		return clerk.session.getToken({ template: 'convex' });
	};

	client.setAuth(getClerkAuthToken);

	const themeStore = setThemeStore();
	const auth = getAuthState();
	const billingStore = setBillingStore();
	const instanceStore = setInstanceStore();

	let isInitializing = $state(true);
	let showUserMenu = $state(false);

	const toggleTheme = () => {
		themeStore.toggle();
	};

	onMount(async () => {
		clerkInitPromise = (async () => {
			try {
				const clerk = await initializeClerk();
				setAuthState(clerk);

				clerk.addListener((resources) => {
					if (!resources.user) {
						setInstanceId(null);
					}
				});
			} catch (error) {
				console.error('Failed to initialize auth:', error);
			} finally {
				isInitializing = false;
			}
		})();

		await clerkInitPromise;
	});

	$effect(() => {
		const instance = instanceStore.instance;
		untrack(() => setInstanceId(instance?._id ?? null));
	});

	$effect(() => {
		const userId = auth.instanceId;
		untrack(() => billingStore.setUserId(userId));
	});

	$effect(() => {
		const isSignedIn = auth.isSignedIn;
		const needsBootstrap = instanceStore.needsBootstrap;
		const isBootstrapping = instanceStore.isBootstrapping;

		if (isSignedIn && needsBootstrap && !isBootstrapping) {
			untrack(() => {
				void instanceStore.ensureExists();
			});
		}
	});

	function handleSignOut() {
		showUserMenu = false;
		signOut();
	}

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.user-menu-container')) {
			showUserMenu = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<svelte:head>
	<title>btca Chat</title>
	<meta name="description" content="Web-based chat interface for btca" />
</svelte:head>

<div class="relative flex h-dvh flex-col overflow-hidden">
	<div aria-hidden="true" class="bc-appBg pointer-events-none absolute inset-0 -z-10"></div>

	<header class="bc-header sticky top-0 z-20">
		<div class="bc-container flex items-center justify-between gap-4 py-4">
			<a href="/" class="bc-chip" aria-label="Go home">
				<div class="bc-logoMark">
					<Bot size={18} strokeWidth={2.25} />
				</div>
				<div class="min-w-0 leading-tight">
					<div class="bc-title text-sm">btca Chat</div>
					<div class="bc-subtitle text-xs">Web-based btca interface</div>
				</div>
			</a>

			<div class="flex items-center gap-2">
				{#if billingStore.isSubscribed}
					<a href="/settings/usage" class="bc-chip hidden sm:inline-flex"> Usage </a>
				{:else}
					<a href="/pricing" class="bc-chip hidden sm:inline-flex"> Pricing </a>
				{/if}
				<a
					class="bc-chip"
					href="https://github.com/bmdavis419/better-context"
					target="_blank"
					rel="noreferrer"
					aria-label="GitHub"
					title="GitHub"
				>
					<Github size={18} strokeWidth={2.25} />
				</a>

				<button
					type="button"
					class="bc-chip"
					onclick={toggleTheme}
					aria-label="Toggle theme"
					title={themeStore.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
				>
					{#if themeStore.theme === 'dark'}
						<Sun size={18} strokeWidth={2.25} />
					{:else}
						<Moon size={18} strokeWidth={2.25} />
					{/if}
				</button>

				<!-- Auth Section -->
				{#if isInitializing}
					<div class="bc-chip">
						<Loader2 size={18} class="animate-spin" />
					</div>
				{:else if auth.isSignedIn && auth.user}
					<div class="user-menu-container relative">
						<button
							type="button"
							class="bc-chip flex items-center gap-2"
							onclick={() => (showUserMenu = !showUserMenu)}
							aria-label="User menu"
						>
							{#if auth.user.imageUrl}
								<img
									src={auth.user.imageUrl}
									alt={auth.user.fullName ?? 'User'}
									class="h-6 w-6 rounded-full"
								/>
							{:else}
								<User size={18} strokeWidth={2.25} />
							{/if}
						</button>

						{#if showUserMenu}
							<div
								class="bc-card absolute right-0 top-full mt-2 min-w-48 overflow-hidden p-0 shadow-lg"
							>
								<div class="border-b border-[hsl(var(--bc-border))] px-4 py-3">
									<div class="text-sm font-medium">{auth.user.fullName ?? 'User'}</div>
									<div class="bc-muted text-xs">
										{auth.user.primaryEmailAddress?.emailAddress ?? ''}
									</div>
								</div>
								<div class="py-1">
									<button
										type="button"
										class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-[hsl(var(--bc-bg-muted))]"
										onclick={() => {
											showUserMenu = false;
											openUserProfile();
										}}
									>
										<User size={16} />
										Profile
									</button>
									<a
										href="/settings/usage"
										class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-[hsl(var(--bc-bg-muted))]"
										onclick={() => (showUserMenu = false)}
									>
										<BarChart3 size={16} />
										Usage
									</a>
									<a
										href="/settings/billing"
										class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-[hsl(var(--bc-bg-muted))]"
										onclick={() => (showUserMenu = false)}
									>
										<CreditCard size={16} />
										Billing
									</a>
									<a
										href="/settings/api-keys"
										class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-[hsl(var(--bc-bg-muted))]"
										onclick={() => (showUserMenu = false)}
									>
										<Key size={16} />
										MCP
									</a>
									<a
										href="/settings/resources"
										class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-[hsl(var(--bc-bg-muted))]"
										onclick={() => (showUserMenu = false)}
									>
										<Settings size={16} />
										Resources
									</a>
									<button
										type="button"
										class="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-500 hover:bg-[hsl(var(--bc-bg-muted))]"
										onclick={handleSignOut}
									>
										<LogOut size={16} />
										Sign out
									</button>
								</div>
							</div>
						{/if}
					</div>
				{:else}
					<button type="button" class="bc-btn bc-btn-primary text-sm" onclick={() => openSignIn()}>
						Sign in
					</button>
				{/if}
			</div>
		</div>
	</header>

	<main id="main" class="flex min-h-0 flex-1 flex-col">
		{#if isInitializing}
			<div class="flex flex-1 items-center justify-center">
				<Loader2 size={32} class="animate-spin" />
			</div>
		{:else}
			{@render children()}
		{/if}
	</main>
</div>
