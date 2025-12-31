import { createEffect, createSignal, For, Show, type Component, type Setter } from 'solid-js';
import type { KeyEvent, TextareaRenderable } from '@opentui/core';
import { colors, getColor } from '../theme';
import { usePaste, useTerminalDimensions } from '@opentui/solid';
import type { InputState, CancelState, ThreadState } from '../types.ts';

interface MainInputProps {
	inputState: InputState;
	setInputState: Setter<InputState>;
	cursorPosition: number;
	setCursorPosition: Setter<number>;
	inputRef: TextareaRenderable | null;
	setInputRef: Setter<TextareaRenderable | null>;
	focused: boolean;
	isStreaming: boolean;
	cancelState: CancelState;
	currentThread: ThreadState | null;
}

export const MainInput: Component<MainInputProps> = (props) => {
	const terminalDimensions = useTerminalDimensions();
	let textareaRef: TextareaRenderable | null = null;

	// Track the current display value for the shadow overlay
	const [displayValue, setDisplayValue] = createSignal('');

	const getPasteDisplay = (lines: number) => `[~${lines} lines]`;

	const getValue = () =>
		props.inputState
			.map((p) => (p.type === 'pasted' ? getPasteDisplay(p.lines) : p.content))
			.join('');

	const isEmpty = () => getValue().length === 0;

	// Get dynamic placeholder based on current state
	const getPlaceholder = () => {
		if (props.isStreaming && props.cancelState === 'pending') {
			return 'confirm with esc to cancel';
		}
		if (props.isStreaming) {
			return 'press esc to cancel';
		}
		if (props.currentThread && props.currentThread.resources.length > 0) {
			return 'ask a follow-up... or @repo to add context';
		}
		return '@repo question... or / for commands';
	};

	const getPartValueLength = (p: InputState[number]) =>
		p.type === 'pasted' ? getPasteDisplay(p.lines).length : p.content.length;

	// Calculate available width for text (accounting for border and padding)
	const getAvailableWidth = () => {
		const width = terminalDimensions().width;
		// Subtract 2 for border, 2 for padding (1 each side)
		return Math.max(1, width - 4);
	};

	// Calculate number of lines needed based on content length
	const getLineCount = () => {
		const value = getValue();
		const availableWidth = getAvailableWidth();
		if (value.length === 0) return 1;
		return Math.max(1, Math.ceil(value.length / availableWidth));
	};

	// Get dynamic height for box (content lines + 2 for border)
	const getBoxHeight = () => getLineCount() + 2;

	// Sync input state to textarea when it changes externally (e.g., clearing input)
	createEffect(() => {
		const value = getValue();
		setDisplayValue(value);
		if (textareaRef && textareaRef.plainText !== value) {
			textareaRef.setText(value);
		}
	});

	usePaste((text) => {
		if (!props.focused) return;
		const curInput = props.inputState;
		const lines = text.text.split('\n').length;
		const newInput = [...curInput, { type: 'pasted' as const, content: text.text, lines }];
		props.setInputState(newInput);

		queueMicrotask(() => {
			if (textareaRef) {
				const newValue = newInput
					.map((p) => (p.type === 'pasted' ? getPasteDisplay(p.lines) : p.content))
					.join('');
				textareaRef.setText(newValue);
				textareaRef.gotoBufferEnd();
				const cursor = textareaRef.logicalCursor;
				props.setCursorPosition(cursor.row * getAvailableWidth() + cursor.col);
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

	function handleContentChange(newValue: string) {
		setDisplayValue(newValue);
		const currentParts = props.inputState;
		const pastedBlocks = currentParts.filter((p) => p.type === 'pasted');

		if (pastedBlocks.length === 0) {
			props.setInputState(parseTextSegment(newValue));
			return;
		}

		const result: InputState = [];
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

		props.setInputState(result);
	}

	function handleKeyDown(event: KeyEvent) {
		// Prevent newlines - we want single-line behavior with visual wrapping
		if (event.name === 'return' || event.name === 'linefeed') {
			event.preventDefault();
			return;
		}

		if (event.name === 'backspace') {
			if (!textareaRef) return;
			const cursor = textareaRef.logicalCursor;
			const curPos = cursor.col; // For single-line content, col is the position
			const plainText = textareaRef.plainText;

			// Calculate absolute cursor position
			let absolutePos = 0;
			const lines = plainText.split('\n');
			for (let i = 0; i < cursor.row; i++) {
				absolutePos += (lines[i]?.length ?? 0) + 1; // +1 for newline
			}
			absolutePos += cursor.col;

			const parts = props.inputState;

			let offset = 0;
			for (let i = 0; i < parts.length; i++) {
				const part = parts[i]!;
				const valueLen = getPartValueLength(part);

				if (absolutePos <= offset + valueLen) {
					if (part.type === 'pasted') {
						event.preventDefault();
						const newParts = [...parts.slice(0, i), ...parts.slice(i + 1)];
						props.setInputState(newParts);

						// Update textarea content
						const newValue = newParts
							.map((p) => (p.type === 'pasted' ? getPasteDisplay(p.lines) : p.content))
							.join('');
						textareaRef.setText(newValue);

						// Position cursor at where the pasted block was
						textareaRef.editBuffer.setCursor(0, offset);
						props.setCursorPosition(offset);
						return;
					}
					break;
				}
				offset += valueLen;
			}
		}

		queueMicrotask(() => {
			if (!textareaRef) return;
			const cursor = textareaRef.logicalCursor;
			props.setCursorPosition(cursor.col);
		});
	}

	return (
		<box
			style={{
				border: true,
				borderColor: colors.accent,
				height: getBoxHeight(),
				width: '100%'
			}}
		>
			{/* Styled text overlay - positioned on top of textarea */}
			<text
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					width: '100%',
					height: getLineCount(),
					zIndex: 2,
					paddingLeft: 1,
					paddingRight: 1
				}}
				wrapMode="char"
				onMouseDown={(e) => {
					if (!textareaRef) return;
					// Calculate cursor position from click
					const availableWidth = getAvailableWidth();
					const row = e.y;
					const col = e.x - 1; // -1 for padding
					const pos = row * availableWidth + col;
					textareaRef.editBuffer.setCursor(0, Math.min(pos, getValue().length));
					queueMicrotask(() => {
						props.setCursorPosition(pos);
					});
				}}
			>
				<Show
					when={!isEmpty()}
					fallback={<span style={{ fg: colors.textSubtle }}>{getPlaceholder()}</span>}
				>
					<For each={props.inputState}>
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
			{/* Hidden textarea - handles actual typing, cursor, and word wrap */}
			<textarea
				id="main-input"
				ref={(r: TextareaRenderable) => {
					textareaRef = r;
					props.setInputRef(r);
				}}
				initialValue=""
				wrapMode="char"
				focused={props.focused}
				onContentChange={() => {
					if (textareaRef) {
						handleContentChange(textareaRef.plainText);
					}
				}}
				onKeyDown={handleKeyDown}
				onCursorChange={(e) => {
					props.setCursorPosition(e.visualColumn);
				}}
				// Make textarea text transparent so styled overlay shows through
				textColor="transparent"
				backgroundColor="transparent"
				focusedBackgroundColor="transparent"
				cursorColor={colors.accent}
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					width: '100%',
					minHeight: 1,
					zIndex: 1, // Below the styled text
					paddingLeft: 1,
					paddingRight: 1
				}}
			/>
		</box>
	);
};
