import { colors } from './theme.ts';
import { Messages } from './components/messages.tsx';
import { type Accessor, type Component } from 'solid-js';
import { Header } from './components/header.tsx';
import { InputSection } from './components/input-section.tsx';

const WarningBanner: Component = () => {
	return (
		<box
			style={{
				height: 1,
				width: '100%',
				backgroundColor: colors.error,
				flexDirection: 'row',
				justifyContent: 'center',
				alignItems: 'center'
			}}
		>
			<text fg={colors.bg}>
				{' WARNING: This software is under active development and may contain bugs '}
			</text>
		</box>
	);
};

export const MainUi: Component<{
	heightPercent: Accessor<`${number}%`>;
}> = (props) => {
	return (
		<box
			width="100%"
			height={props.heightPercent()}
			style={{
				flexDirection: 'column',
				backgroundColor: colors.bg
			}}
		>
			<WarningBanner />
			<Header />
			<Messages />
			<InputSection />
		</box>
	);
};

export async function launchTui() {
	await import('./App.tsx');
}
