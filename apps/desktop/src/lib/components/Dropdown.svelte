<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';

	type Option = { value: string; label: string };

	let {
		id = undefined,
		value = $bindable(''),
		options,
		placeholder = 'Select...',
		class: className = ''
	}: {
		id?: string;
		value: string;
		options: Option[];
		placeholder?: string;
		class?: string;
	} = $props();

	let open = $state(false);
	let buttonRef = $state<HTMLButtonElement | null>(null);
	let menuRef = $state<HTMLDivElement | null>(null);

	const selectedOption = $derived(options.find((o) => o.value === value));
	const displayLabel = $derived(selectedOption?.label ?? placeholder);

	const toggle = () => {
		open = !open;
	};

	const select = (optionValue: string) => {
		value = optionValue;
		open = false;
	};

	const handleKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			open = false;
			buttonRef?.focus();
		} else if (e.key === 'ArrowDown' && !open) {
			open = true;
		}
	};

	const handleOptionKeydown = (e: KeyboardEvent, optionValue: string) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			select(optionValue);
		}
	};

	const handleClickOutside = (e: MouseEvent) => {
		const target = e.target as Node;
		if (buttonRef && !buttonRef.contains(target) && menuRef && !menuRef.contains(target)) {
			open = false;
		}
	};

	$effect(() => {
		if (open) {
			document.addEventListener('click', handleClickOutside);
			return () => document.removeEventListener('click', handleClickOutside);
		}
	});
</script>

<div class="dropdown-container {className}">
	<button
		{id}
		bind:this={buttonRef}
		type="button"
		class="dropdown-trigger bc-input"
		onclick={toggle}
		onkeydown={handleKeydown}
		aria-haspopup="listbox"
		aria-expanded={open}
	>
		<span class="dropdown-label" class:placeholder={!selectedOption}>{displayLabel}</span>
		<ChevronDown size={14} class="dropdown-chevron {open ? 'open' : ''}" />
	</button>

	{#if open}
		<div bind:this={menuRef} class="dropdown-menu" role="listbox">
			{#each options as option}
				<button
					type="button"
					class="dropdown-option"
					class:selected={option.value === value}
					onclick={() => select(option.value)}
					onkeydown={(e) => handleOptionKeydown(e, option.value)}
					role="option"
					aria-selected={option.value === value}
				>
					{option.label}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.dropdown-container {
		position: relative;
	}

	.dropdown-trigger {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		text-align: left;
		cursor: pointer;
	}

	.dropdown-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.dropdown-label.placeholder {
		color: hsl(var(--bc-fg-muted));
	}

	.dropdown-chevron {
		flex-shrink: 0;
		color: hsl(var(--bc-fg-muted));
		transition: transform 0.15s;
	}

	.dropdown-chevron.open {
		transform: rotate(180deg);
	}

	.dropdown-menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		z-index: 50;
		max-height: 240px;
		overflow-y: auto;
		background: hsl(var(--bc-surface));
		border: 1px solid hsl(var(--bc-border));
		border-radius: 0;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	.dropdown-option {
		display: block;
		width: 100%;
		padding: 8px 12px;
		text-align: left;
		font-size: 0.875rem;
		color: hsl(var(--bc-text));
		background: transparent;
		border: none;
		cursor: pointer;
		transition: background 0.1s;
	}

	.dropdown-option:hover {
		background: hsl(var(--bc-surface-2));
	}

	.dropdown-option.selected {
		background: hsl(var(--bc-accent) / 0.1);
		color: hsl(var(--bc-accent));
	}

	.dropdown-option:focus {
		outline: none;
		background: hsl(var(--bc-surface-2));
	}
</style>
