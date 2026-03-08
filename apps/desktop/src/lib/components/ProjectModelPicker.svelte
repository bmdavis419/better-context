<script lang="ts">
	import { ChevronDown, Loader2, Check } from '@lucide/svelte';
	import { useQuery } from 'convex-svelte';

	import { api } from '@btca/convex/api';
	import { WEB_SANDBOX_MODELS, getWebSandboxModel } from '@btca/convex/webSandboxModels';
	import { getInstanceStore } from '../stores/instance.svelte';
	import { getProjectStore } from '../stores/project.svelte';

	type Props = {
		disabled?: boolean;
	};

	let { disabled = false }: Props = $props();

	const instanceStore = getInstanceStore();
	const projectStore = getProjectStore();

	const selectedProject = $derived(projectStore.selectedProject);
	const selectedProjectId = $derived(selectedProject?._id);
	const activeModel = $derived(getWebSandboxModel(selectedProject?.model));
	const threadsQuery = $derived(
		selectedProjectId ? useQuery(api.threads.list, { projectId: selectedProjectId }) : null
	);
	const hasStreamingThread = $derived(
		((threadsQuery?.data ?? []) as Array<{ isStreaming: boolean }>).some(
			(thread) => thread.isStreaming
		)
	);
	const isSwitchDisabled = $derived(disabled || hasStreamingThread || !selectedProject);

	let isSaving = $state(false);
	let isOpen = $state(false);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let menuEl = $state<HTMLDivElement | null>(null);

	function toggle() {
		if (isSwitchDisabled || isSaving) return;
		isOpen = !isOpen;
	}

	function close() {
		isOpen = false;
	}

	function handleClickOutside(event: MouseEvent) {
		if (!isOpen) return;
		const target = event.target as Node;
		if (triggerEl?.contains(target) || menuEl?.contains(target)) return;
		close();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && isOpen) {
			event.stopPropagation();
			close();
		}
	}

	$effect(() => {
		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
			document.addEventListener('keydown', handleKeydown);
			return () => {
				document.removeEventListener('mousedown', handleClickOutside);
				document.removeEventListener('keydown', handleKeydown);
			};
		}
	});

	async function selectModel(modelId: string) {
		const project = selectedProject;
		if (!project || modelId === activeModel.id || isSwitchDisabled) return;

		close();
		isSaving = true;

		const saved = await projectStore.updateProjectModel(project._id, modelId);
		if (!saved) {
			isSaving = false;
			return;
		}

		if (instanceStore.state === 'running') {
			await instanceStore.applyProjectRuntimeConfig(project._id);
		}

		isSaving = false;
	}
</script>

{#if selectedProject}
	<div class="relative inline-flex">
		<button
			type="button"
			class="model-trigger"
			bind:this={triggerEl}
			onclick={toggle}
			disabled={isSwitchDisabled || isSaving}
		>
			{#if isSaving}
				<Loader2 size={12} class="animate-spin" />
			{/if}
			<span class="model-trigger-label">{activeModel.label}</span>
			<span class="bc-muted text-[10px]">{activeModel.description}</span>
			<ChevronDown size={12} class="bc-muted" />
		</button>

		{#if isOpen}
			<div class="model-menu" bind:this={menuEl}>
				{#each WEB_SANDBOX_MODELS as model}
					<button
						type="button"
						class="model-option"
						class:model-option-active={model.id === activeModel.id}
						onclick={() => selectModel(model.id)}
					>
						<span class="flex items-center gap-2">
							<span class="text-xs font-medium">{model.label}</span>
							<span class="bc-muted text-[10px]">{model.description}</span>
						</span>
						{#if model.id === activeModel.id}
							<Check size={12} class="text-[hsl(var(--bc-accent))]" />
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.model-trigger {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 6px;
		border: none;
		background: transparent;
		color: hsl(var(--bc-fg));
		font-size: 11px;
		cursor: pointer;
		transition:
			background 120ms ease,
			color 120ms ease;
	}

	.model-trigger:hover:not(:disabled) {
		background: hsl(var(--bc-surface-2));
	}

	.model-trigger:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.model-trigger-label {
		font-weight: 500;
	}

	.model-menu {
		position: absolute;
		bottom: calc(100% + 4px);
		left: 0;
		min-width: 220px;
		background: hsl(var(--bc-surface));
		border: 1px solid hsl(var(--bc-border));
		z-index: 50;
		padding: 2px 0;
	}

	.model-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 6px 10px;
		border: none;
		background: transparent;
		color: hsl(var(--bc-fg));
		cursor: pointer;
		text-align: left;
		font-size: 12px;
		transition: background 80ms ease;
	}

	.model-option:hover {
		background: hsl(var(--bc-surface-2));
	}

	.model-option-active {
		color: hsl(var(--bc-accent));
	}
</style>
