import { createSignal, type Component } from 'solid-js';
import { ConfigProvider } from './context/config-context.tsx';
import { MessagesProvider } from './context/messages-context.tsx';
import { ToastProvider, useToast } from './context/toast-context.tsx';
import { render, useKeyboard, useRenderer, useSelectionHandler } from '@opentui/solid';
import { MainUi } from './index.tsx';
import { addDefaultParsers, ConsolePosition } from '@opentui/core';
import { copyToClipboard } from './clipboard.ts';
import { parsers } from './parsers-config.ts';

const App: Component = () => {
	const renderer = useRenderer();
	const toast = useToast();

	const [heightPercent, setHeightPercent] = createSignal<`${number}%`>('100%');

	// Auto-copy selected text to clipboard
	useSelectionHandler((selection) => {
		const text = selection.getSelectedText();
		if (text && text.length > 0) {
			void copyToClipboard(text);
			toast.show('Copied to clipboard');
		}
	});

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
			// Stop server before exiting
			globalThis.__BTCA_SERVER__?.stop();
			renderer.destroy();
			return;
		}

		// Ctrl+C to quit (when no input to clear - handled in InputSection)
		if (key.name === 'c' && key.ctrl) {
			// If we reach here, InputSection didn't handle it (no input to clear)
			globalThis.__BTCA_SERVER__?.stop();
			renderer.destroy();
			return;
		}
	});

	return <MainUi heightPercent={heightPercent} />;
};

// Ensure tree-sitter parsers are registered before any markdown/code blocks render.
addDefaultParsers(parsers);

render(
	() => (
		<ConfigProvider>
			<MessagesProvider>
				<ToastProvider>
					<App />
				</ToastProvider>
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
