import { createSignal, createMemo, For, type Component } from 'solid-js';
import { colors } from '../theme.ts';
import { useKeyboard } from '@opentui/solid';
import { useAppContext } from '../context/app-context.tsx';

export const RepoMentionPalette: Component = () => {
	const appState = useAppContext();

	const [selectedIndex, setSelectedIndex] = createSignal(0);

	const maxVisible = 8;

	const getDisplayLength = (item: ReturnType<typeof appState.inputState>[number]) =>
		item.type === 'pasted' ? `[~${item.lines} lines]`.length : item.content.length;

	const curInputIdx = () => {
		const inputRef = appState.inputRef();
		if (!inputRef) return 0;
		const currentInputIndex = inputRef.cursorPosition;
		let curIdx = 0;
		let totalLength = 0;
		const curInputState = appState.inputState();
		while (curIdx < curInputState.length) {
			const curItem = curInputState[curIdx]!;
			const maxIdx = totalLength + getDisplayLength(curItem);
			if (currentInputIndex >= totalLength && currentInputIndex <= maxIdx) {
				break;
			}
			totalLength = maxIdx;
			curIdx++;
		}
		return curIdx;
	};

	const filteredRepos = createMemo(() => {
		const repos = appState.repos();
		const curInput = appState.inputState()[curInputIdx()]?.content;
		if (!curInput) return repos;
		const trimmedInput = curInput.toLowerCase().trim().slice(1);
		return repos.filter((repo) => repo.name.toLowerCase().includes(trimmedInput));
	});

	const visibleRange = createMemo(() => {
		const start = Math.max(
			0,
			Math.min(selectedIndex() - Math.floor(maxVisible / 2), filteredRepos().length - maxVisible)
		);
		return {
			start,
			repos: filteredRepos().slice(start, start + maxVisible)
		};
	});

	const selectRepo = () => {
		const selectedRepo = filteredRepos()[selectedIndex()];
		if (selectedRepo) {
			const idx = curInputIdx();
			const currentState = appState.inputState();
			const newContent = '@' + selectedRepo.name + ' ';
			const newState = [
				...currentState.slice(0, idx),
				{ content: newContent, type: 'mention' as const },
				...currentState.slice(idx + 1)
			];
			appState.setInputState(newState);
			const inputRef = appState.inputRef();
			if (inputRef) {
				let newCursorPos = 0;
				for (let i = 0; i <= idx; i++) {
					newCursorPos += i === idx ? newContent.length : getDisplayLength(currentState[i]!);
				}
				inputRef.cursorPosition = newCursorPos;
			}
		}
	};

	useKeyboard((key) => {
		switch (key.name) {
			case 'up':
				if (selectedIndex() > 0) {
					setSelectedIndex(selectedIndex() - 1);
				} else {
					setSelectedIndex(filteredRepos().length - 1);
				}
				break;
			case 'down':
				if (selectedIndex() < filteredRepos().length - 1) {
					setSelectedIndex(selectedIndex() + 1);
				} else {
					setSelectedIndex(0);
				}
				break;
			case 'tab':
				selectRepo();
				break;
			case 'return':
				selectRepo();
				break;
			default:
				break;
		}
	});

	return (
		<box
			style={{
				position: 'absolute',
				bottom: 5,
				left: 1,
				width: 40,
				backgroundColor: colors.bgSubtle,
				border: true,
				borderColor: colors.accent,
				flexDirection: 'column',
				padding: 1
			}}
		>
			<text fg={colors.textMuted} content=" Select repo:" />
			<For each={visibleRange().repos}>
				{(repo, i) => {
					const actualIndex = () => visibleRange().start + i();
					const isSelected = () => actualIndex() === selectedIndex();
					return (
						<text
							fg={isSelected() ? colors.accent : colors.text}
							content={isSelected() ? `▸ @${repo.name}` : `  @${repo.name}`}
						/>
					);
				}}
			</For>
		</box>
	);
};
