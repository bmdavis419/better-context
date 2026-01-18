<script lang="ts">
	import { MessageSquare, Plus, Trash2, Loader2, BookOpen } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '../convex/_generated/api';
	import { getAuthState } from '$lib/stores/auth.svelte';
	import InstanceCard from '$lib/components/InstanceCard.svelte';
	import ProvisioningModal from '$lib/components/ProvisioningModal.svelte';

	const auth = getAuthState();
	const client = useConvexClient();

	// Convex queries - only run when user is authenticated
	const threadsQuery = $derived(
		auth.instanceId ? useQuery(api.threads.list, { instanceId: auth.instanceId }) : null
	);

	function createNewThread() {
		// Navigate to /chat/new - thread will be created when first message is sent
		goto('/chat/new');
	}

	async function destroyThread(threadId: string) {
		if (!confirm('Are you sure you want to delete this thread?')) return;
		try {
			await client.mutation(api.threads.remove, { threadId: threadId as any });
		} catch (error) {
			console.error('Failed to delete thread:', error);
		}
	}

	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

{#if !auth.isSignedIn}
	<!-- Landing page for unauthenticated users -->
	<div class="flex flex-1 flex-col items-center justify-center gap-6 p-8">
		<div class="bc-logoMark h-16 w-16">
			<MessageSquare size={32} />
		</div>
		<div class="text-center">
			<h1 class="text-3xl font-bold">Welcome to btca Chat</h1>
			<p class="bc-muted mt-2 max-w-md">
				Ask questions about your favorite frameworks and libraries. Sign in to get started.
			</p>
		</div>
		<button type="button" class="bc-btn bc-btn-primary" onclick={() => auth.clerk?.openSignIn()}>
			Sign in to get started
		</button>
	</div>
{:else}
	<ProvisioningModal />
	<!-- Thread list for authenticated users -->
	<div class="flex flex-1 overflow-hidden">
		<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8">
			<InstanceCard />
			<!-- Header -->
			<div class="flex items-center justify-between">
				<div>
					<h1 class="text-2xl font-semibold">Your Threads</h1>
					<p class="bc-muted mt-1 text-sm">Select a thread or create a new one</p>
				</div>
				<div class="flex items-center gap-2">
					<a href="/settings/resources" class="bc-chip" title="Manage Resources">
						<BookOpen size={16} />
						<span class="hidden sm:inline">Resources</span>
					</a>
					<button type="button" class="bc-btn bc-btn-primary" onclick={createNewThread}>
						<Plus size={16} /> New Thread
					</button>
				</div>
			</div>

			<!-- Threads list -->
			{#if threadsQuery?.isLoading}
				<div class="flex flex-1 items-center justify-center py-16">
					<Loader2 size={32} class="animate-spin" />
				</div>
			{:else if !threadsQuery?.data || threadsQuery.data.length === 0}
				<div class="bc-card flex flex-col items-center justify-center gap-4 py-16">
					<div class="bc-logoMark"><MessageSquare size={20} /></div>
					<div class="text-center">
						<h2 class="font-semibold">No threads yet</h2>
						<p class="bc-muted mt-1 text-sm">Create a new thread to get started</p>
					</div>
					<button type="button" class="bc-btn bc-btn-primary" onclick={createNewThread}>
						<Plus size={16} /> New Thread
					</button>
				</div>
			{:else}
				<div class="flex flex-col gap-3">
					{#each threadsQuery.data as thread (thread._id)}
						<a
							href="/chat/{thread._id}"
							class="bc-card flex items-center gap-4 p-4 no-underline transition-colors hover:border-[hsl(var(--bc-fg))]"
						>
							<div class="bc-logoMark shrink-0">
								<MessageSquare size={18} />
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="font-medium">
										{thread.title ?? `Thread ${thread._id.slice(0, 8)}...`}
									</span>
								</div>
								<div class="bc-muted mt-1 text-xs">
									{formatDate(thread.lastActivityAt)}
								</div>
							</div>
							<button
								type="button"
								class="bc-chip shrink-0 p-2"
								onclick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									destroyThread(thread._id);
								}}
							>
								<Trash2 size={16} />
							</button>
						</a>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}
