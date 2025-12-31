import type { Component } from 'solid-js';
import { colors } from '../theme';
import { useConfigContext } from '../context/config-context.tsx';

export const Header: Component = () => {
	const config = useConfigContext();

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
				content={`${config.selectedProvider()}/${config.selectedModel()}`}
			/>
		</box>
	);
};
