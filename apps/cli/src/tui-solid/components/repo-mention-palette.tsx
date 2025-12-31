import { createSignal, createMemo, For, type Component, type Setter } from 'solid-js';
import type { TextareaRenderable } from '@opentui/core';
import { colors } from '../theme.ts';
import { useKeyboard } from '@opentui/solid';
import { useConfigContext } from '../context/config-context.tsx';
import type { InputState } from '../types.ts';

interface RepoMentionPaletteProps {
	inputState: InputState;
	setInputState: Setter<InputState>;
	inputRef: TextareaRenderable | null;
	cursorPosition: number;
}

export const RepoMentionPalette: Component<RepoMentionPaletteProps> = (props) => {
	const config = useConfigContext();

	const [selectedIndex, setSelectedIndex] = createSignal(0);

	const maxVisible = 8;

	const getDisplayLength = (item: InputState[number]) =>
		item.type === 'pasted' ? `[~${item.lines} lines]`.length : item.content.length;

	const curInputIdx = () => {
		const inputRef = props.inputRef;
		if (!inputRef) return 0;
		const cursor = inputRef.logicalCursor;
		const currentInputIndex = cursor.col; // For single-line, col is the position
		let curIdx = 0;
		let totalLength = 0;
		const curInputState = props.inputState;
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
		const repos = config.repos();
		const curInput = props.inputState[curInputIdx()]?.content;
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
			const currentState = props.inputState;
			const newContent = '@' + selectedRepo.name + ' ';
			const newState = [
				...currentState.slice(0, idx),
				{ content: newContent, type: 'mention' as const },
				...currentState.slice(idx + 1)
			];
			props.setInputState(newState);
			const inputRef = props.inputRef;
			if (inputRef) {
				let newCursorPos = 0;
				for (let i = 0; i <= idx; i++) {
					newCursorPos += i === idx ? newContent.length : getDisplayLength(currentState[i]!);
				}
				// Calculate the new text and update textarea
				const newText = newState
					.map((p) => (p.type === 'pasted' ? `[~${p.lines} lines]` : p.content))
					.join('');
				inputRef.setText(newText);
				inputRef.editBuffer.setCursor(0, newCursorPos);
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
