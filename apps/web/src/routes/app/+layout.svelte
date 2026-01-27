<script lang="ts">
	import { Loader2, Menu } from '@lucide/svelte';
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { setupConvex, useConvexClient, useQuery } from 'convex-svelte';
	import { env } from '$env/dynamic/public';
	import { initializeClerk, getClerk } from '$lib/clerk';
	import { setAuthState, getAuthState, setInstanceId } from '$lib/stores/auth.svelte';
	import { setBillingStore } from '$lib/stores/billing.svelte';
	import { setInstanceStore } from '$lib/stores/instance.svelte';
	import { setProjectStore } from '$lib/stores/project.svelte';
	import {
		identifyUser,
		resetUser,
		trackEvent,
		ClientAnalyticsEvents
	} from '$lib/stores/analytics.svelte';
	import { api } from '../../convex/_generated/api';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import ProvisioningModal from '$lib/components/ProvisioningModal.svelte';
	import CreateProjectModal from '$lib/components/CreateProjectModal.svelte';

	let { children } = $props();

	setupConvex(env.PUBLIC_CONVEX_URL!);

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

	const auth = getAuthState();
	const billingStore = setBillingStore();
	const instanceStore = setInstanceStore();
	const projectStore = setProjectStore();

	let isInitializing = $state(true);
	let sidebarOpen = $state(false);

	const routeId = $derived((page.params as { id?: string }).id);
	const currentThreadId = $derived(routeId && routeId !== 'new' ? routeId : null);
	const selectedProjectId = $derived(projectStore.selectedProject?._id);
	const threadsQuery = $derived(
		auth.instanceId
			? useQuery(api.threads.list, selectedProjectId ? { projectId: selectedProjectId } : {})
			: null
	);
	const threads = $derived(threadsQuery?.data ?? []);
	const threadsLoading = $derived(threadsQuery?.isLoading ?? false);

	onMount(async () => {
		clerkInitPromise = (async () => {
			try {
				const clerk = await initializeClerk();
				setAuthState(clerk);

				clerk.addListener((resources) => {
					if (!resources.user) {
						setInstanceId(null);
						resetUser();
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
		const user = auth.user;
		const clerkId = auth.clerk?.user?.id;
		if (user && clerkId) {
			untrack(() => {
				identifyUser(clerkId, {
					email: user.primaryEmailAddress?.emailAddress,
					name: user.fullName
				});
				trackEvent(ClientAnalyticsEvents.USER_SIGNED_IN, {
					hasEmail: !!user.primaryEmailAddress?.emailAddress
				});
			});
		}
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

	$effect(() => {
		page.url.pathname;
		sidebarOpen = false;
	});

	$effect(() => {
		const projects = projectStore.projects;
		const urlProjectId = page.url.searchParams.get('project');
		if (projects.length > 0 && !projectStore.initialized) {
			untrack(() => projectStore.initFromUrl(urlProjectId));
		}
	});
</script>

<svelte:head>
	<title>btca | App</title>
	<meta name="description" content="Web-based chat interface for btca" />
</svelte:head>

<div class="relative flex h-dvh overflow-hidden">
	<div aria-hidden="true" class="bc-appBg pointer-events-none absolute inset-0 -z-10"></div>

	{#if auth.isSignedIn}
		<button
			type="button"
			class="bc-iconBtn fixed left-4 top-4 z-50 lg:hidden"
			onclick={() => (sidebarOpen = true)}
			aria-label="Open sidebar"
		>
			<Menu size={18} />
		</button>

		<aside
			class={`bc-sidebar fixed inset-y-0 left-0 z-40 w-64 shrink-0 transform transition-transform duration-200 ease-out lg:relative lg:translate-x-0 ${
				sidebarOpen ? 'translate-x-0' : '-translate-x-full'
			}`}
		>
			<Sidebar
				{threads}
				{currentThreadId}
				isOpen={sidebarOpen}
				isLoading={threadsLoading}
				on:close={() => (sidebarOpen = false)}
			/>
		</aside>

		{#if sidebarOpen}
			<button
				type="button"
				class="fixed inset-0 z-30 bg-black/50 lg:hidden"
				onclick={() => (sidebarOpen = false)}
				aria-label="Close sidebar"
			></button>
		{/if}
	{/if}

	<main class="relative flex min-h-0 flex-1 flex-col">
		{#if isInitializing}
			<div class="flex flex-1 items-center justify-center">
				<Loader2 size={32} class="animate-spin" />
			</div>
		{:else}
			{@render children()}
		{/if}
	</main>
</div>

<ProvisioningModal />
<CreateProjectModal {projectStore} />
