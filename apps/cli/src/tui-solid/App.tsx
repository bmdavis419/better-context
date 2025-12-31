import { createSignal, type Component } from 'solid-js';
import { ConfigProvider } from './context/config-context.tsx';
import { MessagesProvider } from './context/messages-context.tsx';
import { render, useKeyboard, useRenderer } from '@opentui/solid';
import { MainUi } from '.';
import { ConsolePosition } from '@opentui/core';

const App: Component = () => {
	const renderer = useRenderer();

	const [heightPercent, setHeightPercent] = createSignal<`${number}%`>('100%');

	useKeyboard((key) => {
		// Debug console toggle
		if (key.raw === '\x00') {
			if (heightPercent() === '100%') {
				setHeightPercent('80%');
				renderer.console.show();
			} else {
				setHeightPercent('100%');
				renderer.console.hide();
			}
			return;
		}

		// Ctrl+Q to quit
		if (key.name === 'q' && key.ctrl) {
			renderer.destroy();
			return;
		}

		// Ctrl+C to quit (when no input to clear - handled in InputSection)
		if (key.name === 'c' && key.ctrl) {
			// If we reach here, InputSection didn't handle it (no input to clear)
			renderer.destroy();
			return;
		}
	});

	return <MainUi heightPercent={heightPercent} />;
};

render(
	() => (
		<ConfigProvider>
			<MessagesProvider>
				<App />
			</MessagesProvider>
		</ConfigProvider>
	),
	{
		targetFps: 30,
		consoleOptions: {
			position: ConsolePosition.BOTTOM,
			sizePercent: 20,
			maxStoredLogs: 500
		},
		exitOnCtrlC: false
	}
);
