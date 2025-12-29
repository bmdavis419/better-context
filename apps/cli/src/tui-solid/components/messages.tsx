import { For, Show, createSignal, onCleanup, type Component } from 'solid-js';
import { useAppContext } from '../context/app-context';
import { colors, getColor } from '../theme';
import { MarkdownText } from './markdown-text.tsx';

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const LoadingSpinner: Component = () => {
	const [frameIndex, setFrameIndex] = createSignal(0);

	const interval = setInterval(() => {
		setFrameIndex((prev) => (prev + 1) % spinnerFrames.length);
	}, 80);

	onCleanup(() => clearInterval(interval));

	return <text fg={colors.success}>{spinnerFrames[frameIndex()]} </text>;
};

export const Messages: Component = () => {
	const appState = useAppContext();

	return (
		<scrollbox
			style={{
				flexGrow: 1,
				rootOptions: {
					border: true,
					borderColor: colors.border
				},
				contentOptions: {
					flexDirection: 'column',
					padding: 1,
					gap: 2
				},
				stickyScroll: true,
				stickyStart: 'bottom'
			}}
		>
			<For each={appState.messageHistory()}>
				{(m, index) => {
					if (m.role === 'user') {
						return (
							<box style={{ flexDirection: 'column', gap: 1 }}>
								<text fg={colors.accent}>You </text>
								<text>
									<For each={m.content}>
										{(part) => <span style={{ fg: getColor(part.type) }}>{part.content}</span>}
									</For>
								</text>
							</box>
						);
					}
					if (m.role === 'system') {
						return (
							<box style={{ flexDirection: 'column', gap: 1 }}>
								<text fg={colors.info}>SYS </text>
								<text fg={colors.text} content={`${m.content}`} />
							</box>
						);
					}
					if (m.role === 'assistant') {
						const isLastAssistant = () => {
							const history = appState.messageHistory();
							for (let i = history.length - 1; i >= 0; i--) {
								if (history[i]?.role === 'assistant') {
									return i === index();
								}
							}
							return false;
						};
						const isStreaming = () => appState.mode() === 'loading' && isLastAssistant();

						return (
							<box style={{ flexDirection: 'column', gap: 1 }}>
								<box style={{ flexDirection: 'row' }}>
									<text fg={colors.success}>AI </text>
									<Show when={isStreaming()}>
										<LoadingSpinner />
									</Show>
								</box>
								<Show when={!isStreaming()} fallback={<text>{m.content}</text>}>
									<MarkdownText content={m.content} />
								</Show>
							</box>
						);
					}
				}}
			</For>
		</scrollbox>
	);
};
