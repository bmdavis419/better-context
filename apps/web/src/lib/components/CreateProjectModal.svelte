<script lang="ts">
	import { Loader2 } from '@lucide/svelte';
	import type { ProjectStore } from '$lib/stores/project.svelte';

	interface Props {
		projectStore: ProjectStore;
	}

	let { projectStore }: Props = $props();

	let newProjectName = $state('');
	let isCreating = $state(false);

	function closeModal() {
		projectStore.showCreateModal = false;
		newProjectName = '';
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.currentTarget === event.target) closeModal();
	}

	async function createProject() {
		if (!newProjectName.trim()) return;
		isCreating = true;
		const projectId = await projectStore.createProject(newProjectName.trim());
		isCreating = false;
		if (projectId) {
			await projectStore.selectProjectWithNavigation(projectId);
			closeModal();
		}
	}
</script>

{#if projectStore.showCreateModal}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={handleBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && closeModal()}
	>
		<div class="bc-card w-full max-w-md p-6" role="document">
			<h2 class="mb-4 text-lg font-semibold">Create New Project</h2>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					createProject();
				}}
			>
				<div class="mb-4">
					<label for="project-name" class="mb-1 block text-sm font-medium">Project Name</label>
					<input
						id="project-name"
						type="text"
						class="bc-input w-full"
						placeholder="my-project"
						bind:value={newProjectName}
						disabled={isCreating}
					/>
				</div>

				{#if projectStore.error}
					<div class="mb-4 text-sm text-red-500">
						{projectStore.error}
					</div>
				{/if}

				<div class="flex justify-end gap-2">
					<button type="button" class="bc-btn text-xs" onclick={closeModal} disabled={isCreating}>
						Cancel
					</button>
					<button
						type="submit"
						class="bc-btn bc-btn-primary text-xs"
						disabled={!newProjectName.trim() || isCreating}
					>
						{#if isCreating}
							<Loader2 size={14} class="animate-spin" />
							Creating...
						{:else}
							Create
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
