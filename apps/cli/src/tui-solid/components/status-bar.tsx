import type { Component } from 'solid-js';
import { colors } from '../theme';
import { useAppContext } from '../context/app-context';

declare const __VERSION__: string;
const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

export const StatusBar: Component = () => {
	const appState = useAppContext();

	const getHelpText = () => {
		const mode = appState.mode();
		const cursorIn = appState.cursorIsCurrentlyIn();

		if (mode === 'loading') {
			return ' Streaming response...';
		}

		if (mode === 'add-repo') {
			return appState.wizardStep() === 'confirm'
				? ' [Enter] Confirm  [Esc] Cancel'
				: ' [Enter] Next  [Esc] Cancel';
		}

		if (mode === 'remove-repo') {
			return appState.removeRepoName()
				? ' [Y] Yes  [N/Esc] Cancel'
				: ' [Enter] Select  [Esc] Cancel';
		}

		if (mode === 'config-model') {
			return appState.modelStep() === 'confirm'
				? ' [Enter] Confirm  [Esc] Cancel'
				: ' [Enter] Next  [Esc] Cancel';
		}

		if (cursorIn === 'command') {
			return ' [Up/Down] Navigate  [Enter] Select  [Esc] Cancel';
		}

		if (cursorIn === 'mention') {
			return ' [Up/Down] Navigate  [Tab/Enter] Select  [Esc] Cancel';
		}

		return ' [@repo] Ask question  [/] Commands  [Ctrl+C] Quit';
	};

	return (
		<box
			style={{
				height: 1,
				width: '100%',
				backgroundColor: colors.bgMuted,
				flexDirection: 'row',
				justifyContent: 'space-between',
				paddingLeft: 1,
				paddingRight: 1
			}}
		>
			<text fg={colors.textSubtle} content={getHelpText()} />
			<text fg={colors.textSubtle} content={`v${VERSION}`} />
		</box>
	);
};
