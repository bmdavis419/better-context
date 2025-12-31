import type { Component } from 'solid-js';
import { colors } from '../theme';
import type { CancelState } from '../types.ts';
import type { ActiveWizard, WizardStep } from './input-section.tsx';

declare const __VERSION__: string;
const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

interface StatusBarProps {
	activeWizard: ActiveWizard;
	wizardStep: WizardStep;
	cursorIn: string;
	isStreaming: boolean;
	cancelState: CancelState;
	hasConfirmPrompt?: boolean;
}

export const StatusBar: Component<StatusBarProps> = (props) => {
	const getHelpText = () => {
		if (props.isStreaming) {
			if (props.cancelState === 'pending') {
				return ' Press [Esc] again to confirm cancel';
			}
			return ' Streaming... [Esc] to cancel';
		}

		if (props.activeWizard === 'add-repo') {
			return props.wizardStep === 'confirm'
				? ' [Enter] Confirm  [Esc] Cancel'
				: ' [Enter] Next  [Esc] Cancel';
		}

		if (props.activeWizard === 'remove-repo') {
			return props.hasConfirmPrompt ? ' [Y] Yes  [N/Esc] Cancel' : ' [Enter] Select  [Esc] Cancel';
		}

		if (props.activeWizard === 'config-model') {
			return props.wizardStep === 'confirm'
				? ' [Enter] Confirm  [Esc] Cancel'
				: ' [Enter] Next  [Esc] Cancel';
		}

		if (props.activeWizard === 'blessed-model') {
			return ' [Up/Down] Navigate  [Enter] Select  [Esc] Cancel';
		}

		if (props.cursorIn === 'command') {
			return ' [Up/Down] Navigate  [Enter] Select  [Esc] Cancel';
		}

		if (props.cursorIn === 'mention') {
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
