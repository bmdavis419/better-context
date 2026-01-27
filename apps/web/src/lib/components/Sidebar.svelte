<script lang="ts">
	import {
		BookOpen,
		Bot,
		Check,
		ChevronDown,
		FolderOpen,
		Loader2,
		MessageSquare,
		Moon,
		Plus,
		Search,
		Settings,
		Sun,
		Trash2,
		User,
		X
	} from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { createEventDispatcher } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api';
	import { getAuthState, openSignIn, signOut } from '$lib/stores/auth.svelte';
	import { getThemeStore } from '$lib/stores/theme.svelte';
	import { getProjectStore } from '$lib/stores/project.svelte';
	import InstanceStatus from '$lib/components/InstanceStatus.svelte';
	import { trackEvent, ClientAnalyticsEvents } from '$lib/stores/analytics.svelte';

	type ThreadItem = {
		_id: string;
		title?: string | null;
		lastActivityAt: number;
		isStreaming?: boolean;
	};

	interface Props {
		threads: ThreadItem[];
		currentThreadId: string | null;
		isOpen: boolean;
		isLoading?: boolean;
	}

	let { threads, currentThreadId, isOpen, isLoading = false }: Props = $props();

	const dispatch = createEventDispatcher<{ close: void }>();
	const auth = getAuthState();
	const themeStore = getThemeStore();
	const projectStore = getProjectStore();
	const client = useConvexClient();

	let searchValue = $state('');
	let showUserMenu = $state(false);
	let showProjectsSection = $state(true);

	const filteredThreads = $derived.by(() => {
		const query = searchValue.trim().toLowerCase();
		if (!query) return threads;
		return threads.filter((thread) => (thread.title ?? thread._id).toLowerCase().includes(query));
	});

	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function handleNavigate() {
		if (isOpen) dispatch('close');
	}

	function createNewThread() {
		goto('/app/chat/new');
		handleNavigate();
	}

	async function destroyThread(threadId: string) {
		if (!confirm('Are you sure you want to delete this thread?')) return;
		try {
			await client.mutation(api.threads.remove, { threadId: threadId as any });
		} catch (error) {
			console.error('Failed to delete thread:', error);
		}
	}

	function toggleTheme() {
		themeStore.toggle();
		showUserMenu = false;
	}

	function handleSignOut() {
		showUserMenu = false;
		trackEvent(ClientAnalyticsEvents.USER_SIGNED_OUT);
		signOut();
	}

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.sidebar-user-menu')) {
			showUserMenu = false;
		}
	}

	async function selectProject(projectId: string) {
		await projectStore.selectProjectWithNavigation(projectId as any);
	}

	function openCreateProjectModal() {
		projectStore.showCreateModal = true;
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="bc-sidebar-inner">
	<div class="bc-sidebar-section">
		<a href="/app" class="bc-chip w-full justify-start" aria-label="Go to app home">
			<div class="bc-logoMark h-9 w-9">
				<Bot size={16} strokeWidth={2.25} />
			</div>
			<div class="min-w-0">
				<div class="bc-title text-sm">Better Context</div>
				<div class="bc-subtitle text-[11px]">Chat workspace</div>
			</div>
		</a>
	</div>

	<div class="bc-sidebar-section">
		<button
			type="button"
			class="flex w-full items-center justify-between px-1 py-1 text-[10px] font-semibold uppercase tracking-wider opacity-60 hover:opacity-100"
			onclick={() => (showProjectsSection = !showProjectsSection)}
		>
			<div class="flex min-w-0 items-center gap-2">
				<span class="shrink-0">Projects</span>
				{#if !showProjectsSection && projectStore.selectedProject}
					<span
						class="max-w-[120px] truncate text-[10px] font-normal normal-case tracking-normal opacity-80"
					>
						({projectStore.selectedProject.name})
					</span>
				{/if}
			</div>
			<ChevronDown
				size={12}
				class="shrink-0 transition-transform {showProjectsSection ? '' : '-rotate-90'}"
			/>
		</button>

		{#if showProjectsSection}
			<div class="mt-1 flex flex-col gap-0.5">
				{#if projectStore.isLoading}
					<div class="flex items-center gap-2 px-2 py-1.5 text-xs">
						<Loader2 size={12} class="animate-spin" />
						<span class="bc-muted">Loading...</span>
					</div>
				{:else}
					{#each projectStore.projects as project (project._id)}
						<button
							type="button"
							class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-[hsl(var(--bc-muted)/0.1)] {projectStore
								.selectedProject?._id === project._id
								? 'bg-[hsl(var(--bc-muted)/0.15)]'
								: ''}"
							onclick={() => selectProject(project._id)}
						>
							<FolderOpen size={12} class="shrink-0" />
							<span class="min-w-0 flex-1 truncate">{project.name}</span>
							{#if project.isDefault}
								<span class="bc-muted text-[10px]">(default)</span>
							{/if}
							{#if projectStore.selectedProject?._id === project._id}
								<Check size={12} class="shrink-0 text-[hsl(var(--bc-accent))]" />
							{/if}
						</button>
					{/each}
					<button
						type="button"
						class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[hsl(var(--bc-accent))] transition-colors hover:bg-[hsl(var(--bc-muted)/0.1)]"
						onclick={openCreateProjectModal}
					>
						<Plus size={12} />
						<span>New Project</span>
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<div class="bc-sidebar-section">
		<button
			type="button"
			class="bc-btn bc-btn-primary w-full py-1.5 text-xs"
			onclick={createNewThread}
		>
			<Plus size={14} />
			New Thread
		</button>
	</div>

	<div class="bc-sidebar-section">
		<div class="bc-sidebar-search">
			<Search size={14} class="bc-muted" />
			<input
				type="text"
				class="bc-sidebar-search-input"
				placeholder="Search threads"
				bind:value={searchValue}
			/>
			{#if searchValue}
				<button
					type="button"
					class="bc-sidebar-clear"
					onclick={() => (searchValue = '')}
					aria-label="Clear search"
				>
					<X size={14} />
				</button>
			{/if}
		</div>
	</div>

	<div class="bc-sidebar-section">
		<InstanceStatus />
	</div>

	<div class="bc-thread-list" aria-live="polite">
		{#if isLoading}
			<div class="flex items-center gap-2 px-3 py-2 text-xs">
				<Loader2 size={14} class="animate-spin" />
				Loading threads...
			</div>
		{:else if filteredThreads.length === 0}
			<div class="px-3 py-2 text-xs">
				<div class="font-semibold">
					{searchValue ? 'No matches found' : 'No threads yet'}
				</div>
				<p class="bc-muted mt-1">
					{searchValue ? 'Try a different search.' : 'Create a new thread to get started.'}
				</p>
			</div>
		{:else}
			{#each filteredThreads as thread (thread._id)}
				<a
					href="/app/chat/{thread._id}"
					class={currentThreadId === thread._id
						? 'bc-thread-item bc-thread-item-active'
						: 'bc-thread-item'}
					onclick={handleNavigate}
				>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2 truncate text-sm font-semibold">
							{thread.title ?? `Thread ${thread._id.slice(0, 8)}...`}
							{#if thread.isStreaming}
								<Loader2 size={12} class="shrink-0 animate-spin text-[hsl(var(--bc-accent))]" />
							{/if}
						</div>
						<div class="bc-muted mt-1 text-[11px]">
							{formatDate(thread.lastActivityAt)}
						</div>
					</div>
					<button
						type="button"
						class="bc-thread-item-delete"
						onclick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							destroyThread(thread._id);
						}}
					>
						<Trash2 size={14} />
					</button>
				</a>
			{/each}
		{/if}
	</div>

	<div class="bc-sidebar-section">
		<div class="px-1 py-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">
			Workspace
		</div>
		<div class="mt-1 flex flex-col gap-0.5">
			<a
				href="/app/settings/resources"
				class="flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-[hsl(var(--bc-muted)/0.1)]"
				onclick={handleNavigate}
			>
				<BookOpen size={12} />
				<span>Resources</span>
			</a>
			<a
				href="/app/settings/questions"
				class="flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-[hsl(var(--bc-muted)/0.1)]"
				onclick={handleNavigate}
			>
				<MessageSquare size={12} />
				<span>MCP Questions</span>
			</a>
		</div>
	</div>

	<div class="bc-sidebar-footer">
		{#if auth.isSignedIn && auth.user}
			<div class="sidebar-user-menu relative">
				<button
					type="button"
					class="bc-chip w-full justify-between"
					onclick={() => (showUserMenu = !showUserMenu)}
				>
					<div class="flex min-w-0 items-center gap-2">
						{#if auth.user.imageUrl}
							<img
								src={auth.user.imageUrl}
								alt={auth.user.fullName ?? 'User'}
								class="h-7 w-7 rounded-full"
							/>
						{:else}
							<div class="bc-logoMark h-7 w-7">
								<User size={14} />
							</div>
						{/if}
						<div class="min-w-0 truncate text-xs font-semibold">
							{auth.user.fullName ?? 'User'}
						</div>
					</div>
					<ChevronDown
						size={14}
						class="shrink-0 transition-transform {showUserMenu ? 'rotate-180' : ''}"
					/>
				</button>

				{#if showUserMenu}
					<div
						class="bc-card bc-sidebar-dropdown absolute bottom-full left-0 right-0 mb-2 p-2 text-xs"
					>
						<a
							href="/app/settings"
							class="bc-sidebar-menu-item"
							onclick={() => {
								showUserMenu = false;
								handleNavigate();
							}}
						>
							<Settings size={14} />
							Settings
						</a>
						<button type="button" class="bc-sidebar-menu-item" onclick={toggleTheme}>
							{#if themeStore.theme === 'dark'}
								<Sun size={14} />
								Light mode
							{:else}
								<Moon size={14} />
								Dark mode
							{/if}
						</button>
						<button type="button" class="bc-sidebar-menu-item text-red-500" onclick={handleSignOut}>
							<User size={14} />
							Sign out
						</button>
					</div>
				{/if}
			</div>
		{:else}
			<button
				type="button"
				class="bc-btn bc-btn-primary w-full text-xs"
				onclick={() => openSignIn()}
			>
				Sign in
			</button>
		{/if}
	</div>
</div>
