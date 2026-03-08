<script lang="ts">
	import {
		BookOpen,
		CornerDownLeft,
		LifeBuoy,
		Link,
		MessageSquare,
		Moon,
		Plus,
		Search,
		Settings,
		Sun
	} from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { getThemeStore } from '$lib/stores/theme.svelte';

	type ThreadItem = {
		_id: string;
		title?: string | null;
		lastActivityAt: number;
		isStreaming?: boolean;
	};

	type CommandItem = {
		id: string;
		group: string;
		label: string;
		sublabel?: string;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		icon: any;
		onSelect: () => void;
	};

	interface Props {
		isOpen: boolean;
		threads: ThreadItem[];
		onClose: () => void;
		onOpenAddResource: () => void;
	}

	let { isOpen, threads, onClose, onOpenAddResource }: Props = $props();

	const themeStore = getThemeStore();
	const MAX_VISIBLE_THREADS = 3;

	let searchQuery = $state('');
	let selectedIndex = $state(0);
	let inputEl: HTMLInputElement | undefined = $state(undefined);
	let listEl: HTMLDivElement | undefined = $state(undefined);

	$effect(() => {
		if (isOpen) {
			searchQuery = '';
			selectedIndex = 0;
			setTimeout(() => inputEl?.focus(), 10);
		}
	});

	$effect(() => {
		searchQuery;
		selectedIndex = 0;
	});

	const allItems = $derived.by((): CommandItem[] => {
		const query = searchQuery.trim().toLowerCase();

		const threadItems: CommandItem[] = (() => {
			const filtered = !query
				? threads
				: threads.filter((t) => (t.title ?? t._id).toLowerCase().includes(query));
			return filtered
				.map((t) => ({
					id: `thread-${t._id}`,
					group: 'Threads',
					label: t.title ?? `Thread ${t._id.slice(0, 8)}…`,
					sublabel: new Date(t.lastActivityAt).toLocaleDateString(undefined, {
						month: 'short',
						day: 'numeric'
					}),
					icon: MessageSquare,
					onSelect: () => {
						goto(`/app/chat/${t._id}`);
						onClose();
					}
				}))
				.slice(0, MAX_VISIBLE_THREADS);
		})();

		const actionItems: CommandItem[] = [
			{
				id: 'new-thread',
				group: 'Actions',
				label: 'New Thread',
				icon: Plus,
				onSelect: () => {
					goto('/app/chat/new');
					onClose();
				}
			},
			{
				id: 'add-resource',
				group: 'Actions',
				label: 'Add Resource',
				icon: Link,
				onSelect: () => {
					onOpenAddResource();
					onClose();
				}
			},
			{
				id: 'toggle-theme',
				group: 'Actions',
				label: themeStore.theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
				icon: themeStore.theme === 'dark' ? Sun : Moon,
				onSelect: () => {
					themeStore.toggle();
					onClose();
				}
			}
		];

		const navItems: CommandItem[] = [
			{
				id: 'goto-settings',
				group: 'Navigate',
				label: 'Settings',
				icon: Settings,
				onSelect: () => {
					goto('/app/settings');
					onClose();
				}
			},
			{
				id: 'goto-resources',
				group: 'Navigate',
				label: 'Resources',
				icon: BookOpen,
				onSelect: () => {
					goto('/app/settings/resources');
					onClose();
				}
			},
			{
				id: 'goto-mcp',
				group: 'Navigate',
				label: 'MCP Questions',
				icon: MessageSquare,
				onSelect: () => {
					goto('/app/settings/questions');
					onClose();
				}
			},
			{
				id: 'goto-support',
				group: 'Navigate',
				label: 'Support',
				icon: LifeBuoy,
				onSelect: () => {
					goto('/app/support');
					onClose();
				}
			}
		];

		const filteredNonThread = query
			? [...actionItems, ...navItems].filter(
					(item) =>
						item.label.toLowerCase().includes(query) || item.group.toLowerCase().includes(query)
				)
			: [...actionItems, ...navItems];

		return [...threadItems, ...filteredNonThread];
	});

	const groupedItems = $derived.by(() => {
		const groups: { name: string; items: (CommandItem & { globalIndex: number })[] }[] = [];
		let idx = 0;
		for (const item of allItems) {
			let group = groups.find((g) => g.name === item.group);
			if (!group) {
				group = { name: item.group, items: [] };
				groups.push(group);
			}
			group.items.push({ ...item, globalIndex: idx++ });
		}
		return groups;
	});

	$effect(() => {
		const sel = selectedIndex;
		const el = listEl?.querySelector(`[data-index="${sel}"]`) as HTMLElement | null;
		el?.scrollIntoView({ block: 'nearest' });
	});

	function handleKeydown(event: KeyboardEvent) {
		if (!isOpen) return;

		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
			return;
		}
		if (allItems.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, allItems.length - 1);
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, 0);
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			allItems[selectedIndex]?.onSelect();
			return;
		}
	}
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-start justify-center bg-[hsl(var(--bc-bg))]/80 px-4 pt-[14vh] backdrop-blur-sm"
		role="presentation"
		onclick={onClose}
	>
		<div
			class="bc-card bc-reveal relative w-full max-w-[520px] overflow-hidden"
			style="--delay: 15ms; box-shadow: 0 16px 40px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12);"
			role="dialog"
			aria-modal="true"
			aria-label="Command palette"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={handleKeydown}
		>
			<div class="flex items-center gap-3 border-b border-[hsl(var(--bc-border))] px-4 py-3">
				<Search size={15} class="shrink-0 text-[hsl(var(--bc-fg-muted))]" />
				<input
					bind:this={inputEl}
					type="text"
					class="min-w-0 flex-1 bg-transparent text-sm text-[hsl(var(--bc-fg))] placeholder-[hsl(var(--bc-fg-muted))] focus:outline-none"
					placeholder="Search threads, actions, pages…"
					bind:value={searchQuery}
					aria-label="Search commands"
					autocomplete="off"
					spellcheck="false"
				/>
				<button
					type="button"
					class="shrink-0 border border-[hsl(var(--bc-border))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--bc-fg-muted))] transition-colors hover:border-[hsl(var(--bc-fg-muted))] hover:text-[hsl(var(--bc-fg))]"
					onclick={onClose}
					aria-label="Close command palette"
				>
					Esc
				</button>
			</div>

			<div bind:this={listEl} class="max-h-[360px] overflow-y-auto" role="listbox">
				{#if allItems.length === 0}
					<div class="px-4 py-10 text-center text-sm text-[hsl(var(--bc-fg-muted))]">
						No results for "<span class="text-[hsl(var(--bc-fg))]">{searchQuery}</span>"
					</div>
				{:else}
					{#each groupedItems as group (group.name)}
						<div
							class="px-4 pt-3 pb-1 text-[10px] font-semibold tracking-[0.12em] text-[hsl(var(--bc-fg-muted))] uppercase"
						>
							{group.name}
						</div>
						{#each group.items as item (item.id)}
							{@const isSelected = item.globalIndex === selectedIndex}
							{@const Icon = item.icon}
							<button
								type="button"
								data-index={item.globalIndex}
								class="flex w-full items-center gap-3 border-l-2 px-4 py-2.5 text-left text-sm transition-colors
									{isSelected
									? 'border-[hsl(var(--bc-accent))] bg-[hsl(var(--bc-surface-2))]'
									: 'border-transparent hover:bg-[hsl(var(--bc-surface-2))]'}"
								role="option"
								aria-selected={isSelected}
								onclick={() => item.onSelect()}
								onmouseenter={() => (selectedIndex = item.globalIndex)}
							>
								<Icon
									size={14}
									class="shrink-0 {isSelected
										? 'text-[hsl(var(--bc-accent))]'
										: 'text-[hsl(var(--bc-fg-muted))]'}"
								/>
								<span class="flex-1 truncate font-medium">
									{item.label}
								</span>
								{#if item.sublabel}
									<span class="shrink-0 text-[11px] text-[hsl(var(--bc-fg-muted))]">
										{item.sublabel}
									</span>
								{/if}
							</button>
						{/each}
					{/each}
				{/if}
			</div>

			<div
				class="flex items-center gap-5 border-t border-[hsl(var(--bc-border))] px-4 py-2 text-[10px] text-[hsl(var(--bc-fg-muted))]"
			>
				<span class="flex items-center gap-1.5">
					<kbd
						class="inline-flex items-center border border-[hsl(var(--bc-border))] px-1 py-0.5 font-sans text-[9px]"
						>↑↓</kbd
					>
					navigate
				</span>
				<span class="flex items-center gap-1.5">
					<kbd
						class="inline-flex items-center gap-0.5 border border-[hsl(var(--bc-border))] px-1 py-0.5 font-sans text-[9px]"
					>
						<CornerDownLeft size={8} />
					</kbd>
					select
				</span>
				<span class="flex items-center gap-1.5">
					<kbd
						class="inline-flex items-center border border-[hsl(var(--bc-border))] px-1 py-0.5 font-sans text-[9px]"
						>Esc</kbd
					>
					close
				</span>
			</div>
		</div>
	</div>
{/if}
