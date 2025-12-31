import { createSignal, createMemo, For, Show, type Component, type Setter } from 'solid-js';
import type { TextareaRenderable } from '@opentui/core';
import { colors } from '../theme.ts';
import { useKeyboard } from '@opentui/solid';
import { COMMANDS, filterCommands } from '../commands.ts';
import type { Command, InputState } from '../types.ts';

interface CommandPaletteProps {
	inputState: InputState;
	setInputState: Setter<InputState>;
	inputRef: TextareaRenderable | null;
	onExecute: (command: Command) => void;
}

export const CommandPalette: Component<CommandPaletteProps> = (props) => {
	const input = () => props.inputState[0]?.content;

	const filteredCommands = createMemo(() => {
		const curInput = input();
		if (!curInput) return COMMANDS;
		const trimmedInput = curInput.toLowerCase().trim().slice(1);
		return filterCommands(trimmedInput);
	});

	const [selectedIndex, setSelectedIndex] = createSignal(0);

	useKeyboard((key) => {
		switch (key.name) {
			case 'up':
				if (selectedIndex() > 0) {
					setSelectedIndex(selectedIndex() - 1);
				} else {
					setSelectedIndex(filteredCommands().length - 1);
				}
				break;
			case 'down':
				if (selectedIndex() < filteredCommands().length - 1) {
					setSelectedIndex(selectedIndex() + 1);
				} else {
					setSelectedIndex(0);
				}
				break;
			case 'tab': {
				const curSelectedCommand = filteredCommands()[selectedIndex()];
				if (curSelectedCommand) {
					props.setInputState([{ content: '/' + curSelectedCommand.name, type: 'command' }]);
					const inputRef = props.inputRef;
					if (inputRef) {
						const newText = '/' + curSelectedCommand.name;
						inputRef.setText(newText);
						inputRef.editBuffer.setCursor(0, newText.length);
					}
				}
				break;
			}
			case 'return': {
				const selectedCommand = filteredCommands()[selectedIndex()];
				if (selectedCommand) {
					props.onExecute(selectedCommand);
				}
				break;
			}
			case 'escape':
				props.setInputState([]);
				break;
			default:
				break;
		}
	});

	return (
		<Show
			when={filteredCommands().length > 0}
			fallback={
				<box
					style={{
						position: 'absolute',
						bottom: 4,
						left: 0,
						width: '100%',
						zIndex: 100,
						backgroundColor: colors.bgSubtle,
						border: true,
						borderColor: colors.border,
						padding: 1
					}}
				>
					<text fg={colors.textSubtle} content="No matching commands" />
				</box>
			}
		>
			<box
				style={{
					position: 'absolute',
					bottom: 4,
					left: 0,
					width: '100%',
					zIndex: 100,
					backgroundColor: colors.bgSubtle,
					border: true,
					borderColor: colors.accent,
					flexDirection: 'column',
					padding: 1
				}}
			>
				<text fg={colors.textMuted} content=" Commands" />
				<text content="" style={{ height: 1 }} />
				<For each={filteredCommands()}>
					{(cmd, i) => {
						const isSelected = () => i() === selectedIndex();
						return (
							<box style={{ flexDirection: 'row' }}>
								<text
									fg={isSelected() ? colors.accent : colors.text}
									content={isSelected() ? `▸ /${cmd.name}` : `  /${cmd.name}`}
									style={{ width: 12 }}
								/>
								<text fg={colors.textSubtle} content={` ${cmd.description}`} />
							</box>
						);
					}}
				</For>
			</box>
		</Show>
	);
};
