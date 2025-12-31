import { For, createSignal, createMemo, type Component } from 'solid-js';
import { colors } from '../theme.ts';
import { useKeyboard } from '@opentui/solid';
import { useConfigContext } from '../context/config-context.tsx';
import { useMessagesContext } from '../context/messages-context.tsx';
import { services } from '../services.ts';
import { BLESSED_MODELS } from '@btca/shared';

interface BlessedModelSelectProps {
	onClose: () => void;
}

export const BlessedModelSelect: Component<BlessedModelSelectProps> = (props) => {
	const config = useConfigContext();
	const messages = useMessagesContext();

	const [selectedIndex, setSelectedIndex] = createSignal(0);

	// Find if current model matches a blessed model
	const currentModelIndex = createMemo(() => {
		const provider = config.selectedProvider();
		const model = config.selectedModel();
		return BLESSED_MODELS.findIndex((m) => m.provider === provider && m.model === model);
	});

	const handleSelect = async () => {
		const selectedModel = BLESSED_MODELS[selectedIndex()];
		if (!selectedModel) return;

		try {
			const result = await services.updateModel(selectedModel.provider, selectedModel.model);
			config.setProvider(result.provider);
			config.setModel(result.model);
			messages.addSystemMessage(`Model updated: ${result.provider}/${result.model}`);
		} catch (error) {
			messages.addSystemMessage(`Error: ${error}`);
		} finally {
			props.onClose();
		}
	};

	useKeyboard((key) => {
		switch (key.name) {
			case 'escape':
				props.onClose();
				break;
			case 'up':
				if (selectedIndex() > 0) {
					setSelectedIndex(selectedIndex() - 1);
				} else {
					setSelectedIndex(BLESSED_MODELS.length - 1);
				}
				break;
			case 'down':
				if (selectedIndex() < BLESSED_MODELS.length - 1) {
					setSelectedIndex(selectedIndex() + 1);
				} else {
					setSelectedIndex(0);
				}
				break;
			case 'return':
				handleSelect();
				break;
		}
	});

	return (
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
			<text fg={colors.accent} content=" Select Model" />
			<text fg={colors.textMuted} content=" Use ↑↓ to navigate, Enter to select, Esc to cancel" />
			<text content="" style={{ height: 1 }} />
			<For each={BLESSED_MODELS}>
				{(model, i) => {
					const isSelected = () => i() === selectedIndex();
					const isCurrent = () => i() === currentModelIndex();
					return (
						<box style={{ flexDirection: 'row' }}>
							<text
								fg={isSelected() ? colors.accent : colors.text}
								content={isSelected() ? '▸ ' : '  '}
							/>
							<text
								fg={isSelected() ? colors.accent : colors.text}
								content={`${model.provider}/${model.model}`}
								style={{ width: 30 }}
							/>
							<text
								fg={isCurrent() ? colors.success : colors.textSubtle}
								content={isCurrent() ? `${model.description} (current)` : model.description}
							/>
						</box>
					);
				}}
			</For>
		</box>
	);
};
