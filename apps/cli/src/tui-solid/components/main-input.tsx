import { createEffect, For, Show, type Component } from 'solid-js';
import type { KeyEvent } from '@opentui/core';
import { colors, getColor } from '../theme';
import { useAppContext } from '../context/app-context';
import { usePaste } from '@opentui/solid';

export const MainInput: Component = () => {
	const appState = useAppContext();

	const getPasteDisplay = (lines: number) => `[~${lines} lines]`;

	const getValue = () =>
		appState
			.inputState()
			.map((p) => (p.type === 'pasted' ? getPasteDisplay(p.lines) : p.content))
			.join('');

	const isEmpty = () => getValue().length === 0;

	const getPartValueLength = (p: ReturnType<typeof appState.inputState>[number]) =>
		p.type === 'pasted' ? getPasteDisplay(p.lines).length : p.content.length;

	usePaste((text) => {
		if (appState.mode() !== 'chat') return;
		const curInput = appState.inputState();
		const lines = text.text.split('\n').length;
		const newInput = [...curInput, { type: 'pasted' as const, content: text.text, lines }];
		appState.setInputState(newInput);

		queueMicrotask(() => {
			const inputRef = appState.inputRef();
			if (inputRef) {
				const newCursorPos = newInput.reduce((acc, p) => acc + getPartValueLength(p), 0);
				inputRef.cursorPosition = newCursorPos;
				appState.setCursorPosition(newCursorPos);
			}
		});
	});

	function parseTextSegment(
		value: string
	): { type: 'text' | 'command' | 'mention'; content: string }[] {
		if (!value) return [];
		const parts: { type: 'text' | 'command' | 'mention'; content: string }[] = [];

		if (value.startsWith('/')) {
			const spaceIndex = value.indexOf(' ');
			if (spaceIndex === -1) {
				parts.push({ type: 'command', content: value });
			} else {
				parts.push({ type: 'command', content: value.slice(0, spaceIndex) });
				parts.push({ type: 'text', content: value.slice(spaceIndex) });
			}
			return parts;
		}

		const regex = /(^|(?<=\s))@\w*/g;
		let lastIndex = 0;
		let match;
		while ((match = regex.exec(value)) !== null) {
			if (match.index > lastIndex) {
				parts.push({ type: 'text', content: value.slice(lastIndex, match.index) });
			}
			parts.push({ type: 'mention', content: match[0] });
			lastIndex = regex.lastIndex;
		}

		if (lastIndex < value.length) {
			parts.push({ type: 'text', content: value.slice(lastIndex) });
		}
		return parts;
	}

	function handleInputChange(newValue: string): ReturnType<typeof appState.inputState> {
		const currentParts = appState.inputState();
		const pastedBlocks = currentParts.filter((p) => p.type === 'pasted');

		if (pastedBlocks.length === 0) {
			return parseTextSegment(newValue);
		}

		const result: ReturnType<typeof appState.inputState> = [];
		let remaining = newValue;

		for (let i = 0; i < pastedBlocks.length; i++) {
			const block = pastedBlocks[i]!;
			const display = getPasteDisplay(block.lines);
			const idx = remaining.indexOf(display);

			if (idx === -1) {
				continue;
			}

			const before = remaining.slice(0, idx);
			if (before) {
				result.push(...parseTextSegment(before));
			}
			result.push(block);
			remaining = remaining.slice(idx + display.length);
		}

		if (remaining) {
			result.push(...parseTextSegment(remaining));
		}

		return result;
	}

	return (
		<box
			style={{
				border: true,
				borderColor: colors.accent,
				height: 3,
				width: '100%'
			}}
		>
			{/* Styled text overlay - positioned on top of input */}
			<text
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					width: '100%',
					height: 1,
					zIndex: 2,
					paddingLeft: 1,
					paddingRight: 1
				}}
				onMouseDown={(e) => {
					const inputRef = appState.inputRef();
					if (!inputRef) return;
					inputRef.cursorPosition = e.x - 1;
					queueMicrotask(() => {
						appState.setCursorPosition(inputRef.cursorPosition);
					});
				}}
			>
				<Show
					when={!isEmpty()}
					fallback={
						<span style={{ fg: colors.textSubtle }}>@repo question... or / for commands</span>
					}
				>
					<For each={appState.inputState()}>
						{(part) => {
							if (part.type === 'pasted') {
								return (
									<span
										style={{ fg: colors.bg, bg: colors.accent }}
									>{`[~${part.lines} lines]`}</span>
								);
							} else {
								return <span style={{ fg: getColor(part.type) }}>{part.content}</span>;
							}
						}}
					</For>
				</Show>
			</text>
			{/* Hidden input - handles actual typing and cursor */}
			<input
				id="main-input"
				onInput={(v) => {
					const parts = handleInputChange(v);
					appState.setInputState(parts);
				}}
				onKeyDown={(event: KeyEvent) => {
					if (event.name === 'backspace') {
						const curPos = appState.inputRef()?.cursorPosition ?? 0;
						const parts = appState.inputState();

						let offset = 0;
						for (let i = 0; i < parts.length; i++) {
							const part = parts[i]!;
							const valueLen = getPartValueLength(part);

							if (curPos <= offset + valueLen) {
								if (part.type === 'pasted') {
									event.preventDefault();
									const newParts = [...parts.slice(0, i), ...parts.slice(i + 1)];
									appState.setInputState(newParts);
									const inputRef = appState.inputRef();
									if (inputRef) inputRef.cursorPosition = offset;
									appState.setCursorPosition(offset);
									return;
								}
								break;
							}
							offset += valueLen;
						}
					}
					queueMicrotask(() => {
						const inputRef = appState.inputRef();
						if (!inputRef) return;
						appState.setCursorPosition(inputRef.cursorPosition);
					});
				}}
				value={getValue()}
				focused={appState.mode() === 'chat'}
				ref={(r) => appState.setInputRef(r)}
				// Make input text transparent so styled overlay shows through
				textColor="transparent"
				backgroundColor="transparent"
				focusedBackgroundColor="transparent"
				cursorColor={colors.accent}
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					width: '100%',
					height: 1,
					zIndex: 1, // Below the styled text
					paddingLeft: 1,
					paddingRight: 1
				}}
			/>
		</box>
	);
};
