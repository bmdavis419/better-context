import type { Component } from 'solid-js';
import { colors } from '../theme';
import { useAppContext } from '../context/app-context';

export const Header: Component = () => {
	const appState = useAppContext();

	return (
		<box
			style={{
				height: 3,
				width: '100%',
				backgroundColor: colors.bgSubtle,
				border: true,
				borderColor: colors.border,
				flexDirection: 'row',
				justifyContent: 'space-between',
				alignItems: 'center',
				paddingLeft: 2,
				paddingRight: 2
			}}
		>
			<text>
				<span
					style={{
						textColor: colors.accent
					}}
				>
					{'◆'}
				</span>
				<span
					style={{
						textColor: colors.text
					}}
				>
					{' btca'}
				</span>
				<span
					style={{
						textColor: colors.textMuted
					}}
				>
					{' - The Better Context App'}
				</span>
			</text>
			<text
				fg={colors.textSubtle}
				content={`${appState.selectedProvider()}/${appState.selectedModel()}`}
			/>
		</box>
	);
};
