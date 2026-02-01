<script lang="ts">
	import { ChevronDown, FolderOpen, Plus, Loader2 } from '@lucide/svelte';
	import { getProjectStore } from '$lib/stores/project.svelte';

	const projectStore = getProjectStore();

	let isOpen = $state(false);
	let showCreateModal = $state(false);
	let newProjectName = $state('');
	let isCreating = $state(false);

	function toggleDropdown() {
		isOpen = !isOpen;
	}

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.project-selector')) {
			isOpen = false;
		}
	}

	async function selectProject(projectId: string | null) {
		await projectStore.selectProjectWithNavigation(projectId as any);
		isOpen = false;
	}

	async function createProject() {
		if (!newProjectName.trim()) return;

		isCreating = true;
		const projectId = await projectStore.createProject(newProjectName.trim());
		isCreating = false;

		if (projectId) {
			await selectProject(projectId);
			showCreateModal = false;
			newProjectName = '';
		}
	}

	function openCreateModal() {
		isOpen = false;
		showCreateModal = true;
	}

	function handleCreateModalBackdropClick(event: MouseEvent) {
		if (event.currentTarget === event.target) showCreateModal = false;
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="project-selector relative">
	<button
		type="button"
		class="bc-chip flex w-full items-center justify-between gap-2 px-3 py-2"
		onclick={toggleDropdown}
		disabled={projectStore.isLoading}
	>
		<div class="flex min-w-0 items-center gap-2">
			<FolderOpen size={14} class="shrink-0" />
			<span class="truncate text-xs font-medium">
				{#if projectStore.isLoading}
					Loading...
				{:else if projectStore.selectedProject}
					{projectStore.selectedProject.name}
					{#if projectStore.selectedProject.isDefault}
						<span class="bc-muted text-[10px]">(default)</span>
					{/if}
				{:else}
					No project
				{/if}
			</span>
		</div>
		<ChevronDown size={14} class="shrink-0 transition-transform {isOpen ? 'rotate-180' : ''}" />
	</button>

	{#if isOpen}
		<div class="bc-card absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto p-1">
			{#each projectStore.projects as project (project._id)}
				<button
					type="button"
					class="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs transition-colors hover:bg-[hsl(var(--bc-muted)/0.1)] {projectStore
						.selectedProject?._id === project._id
						? 'bg-[hsl(var(--bc-muted)/0.15)]'
						: ''}"
					onclick={() => selectProject(project._id)}
				>
					<FolderOpen size={12} />
					<span class="truncate">{project.name}</span>
					{#if project.isDefault}
						<span class="bc-muted text-[10px]">(default)</span>
					{/if}
				</button>
			{/each}

			<div class="my-1 border-t border-[hsl(var(--bc-border))]"></div>

			<button
				type="button"
				class="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs text-[hsl(var(--bc-accent))] transition-colors hover:bg-[hsl(var(--bc-muted)/0.1)]"
				onclick={openCreateModal}
			>
				<Plus size={12} />
				Create new project
			</button>
		</div>
	{/if}
</div>

{#if showCreateModal}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={handleCreateModalBackdropClick}
		onkeydown={(e) => e.key === 'Escape' && (showCreateModal = false)}
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
					<label for="project-name" class="mb-1 block text-sm font-medium"> Project Name </label>
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
					<button
						type="button"
						class="bc-btn text-xs"
						onclick={() => (showCreateModal = false)}
						disabled={isCreating}
					>
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
