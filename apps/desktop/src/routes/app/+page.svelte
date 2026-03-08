<script lang="ts">
	import { MessageSquare, Plus } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { getAuthState } from '$lib/stores/auth.svelte';

	const auth = getAuthState();

	function createNewThread() {
		goto('/app/chat/new');
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
	<div class="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
		<div class="bc-logoMark h-16 w-16">
			<MessageSquare size={32} />
		</div>
		<div>
			<h1 class="text-2xl font-semibold">Pick up where you left off</h1>
			<p class="bc-muted mt-2 max-w-md">
				Select a thread from the sidebar or start a new one to begin chatting.
			</p>
		</div>
		<button type="button" class="bc-btn bc-btn-primary" onclick={createNewThread}>
			<Plus size={16} />
			New Thread
		</button>
	</div>
{/if}
