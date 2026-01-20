import { createEffect, createMemo, createResource, createSignal, For, type Component } from 'solid-js';
import { colors } from '../theme.ts';
import { useKeyboard } from '@opentui/solid';
import { useConfigContext } from '../context/config-context.tsx';
import { useMessagesContext } from '../context/messages-context.tsx';
import { services } from '../services.ts';
import { getAuth } from '../../opencode/auth-store.ts';

// Blessed models
const BLESSED_MODELS = [
	{
		provider: 'opencode',
		model: 'claude-haiku-4-5',
		description: 'Claude Haiku 4.5, no reasoning. I HIGHLY recommend this model.'
	},
	{
		provider: 'opencode',
		model: 'minimax-m2.1-free',
		description: 'Minimax M2.1: very fast, very cheap, pretty good'
	},
	{
		provider: 'opencode',
		model: 'glm-4.7-free',
		description: 'GLM 4.7 through opencode zen'
	},
	{
		provider: 'opencode',
		model: 'big-pickle',
		description: 'Big Pickle, surprisingly good (and free)'
	},
	{
		provider: 'opencode',
		model: 'kimi-k2',
		description: 'Kimi K2, no reasoning'
	}
];

const OPENAI_CODEX_MODELS = [
	{
		provider: 'openai',
		model: 'gpt-5.1-codex-mini',
		description: 'GPT-5.1 Codex Mini (ChatGPT Pro/Plus) (recommended)'
	},
	{
		provider: 'openai',
		model: 'gpt-5.2-codex',
		description: 'GPT-5.2 Codex (ChatGPT Pro/Plus)'
	},
	{
		provider: 'openai',
		model: 'gpt-5.2',
		description: 'GPT-5.2 (ChatGPT Pro/Plus)'
	},
	{
		provider: 'openai',
		model: 'gpt-5.1-codex-max',
		description: 'GPT-5.1 Codex Max (ChatGPT Pro/Plus)'
	}
];

interface BlessedModelSelectProps {
	onClose: () => void;
}

export const BlessedModelSelect: Component<BlessedModelSelectProps> = (props) => {
	const config = useConfigContext();
	const messages = useMessagesContext();

	const [selectedIndex, setSelectedIndex] = createSignal(0);
	const [openaiAuth] = createResource(() => getAuth('openai'));

	const modelOptions = createMemo(() => {
		const openaiConnected = Boolean(openaiAuth());
		return openaiConnected ? [...OPENAI_CODEX_MODELS, ...BLESSED_MODELS] : BLESSED_MODELS;
	});

	createEffect(() => {
		const provider = config.selectedProvider();
		const model = config.selectedModel();
		const index = modelOptions().findIndex((m) => m.provider === provider && m.model === model);
		if (index >= 0) {
			setSelectedIndex(index);
			return;
		}
		if (Boolean(openaiAuth())) {
			setSelectedIndex(0);
		} else {
			setSelectedIndex(0);
		}
	});

	// Find if current model matches a blessed model
	const currentModelIndex = createMemo(() => {
		const provider = config.selectedProvider();
		const model = config.selectedModel();
		return modelOptions().findIndex((m) => m.provider === provider && m.model === model);
	});

	const handleSelect = async () => {
		const selectedModel = modelOptions()[selectedIndex()];
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
					setSelectedIndex(modelOptions().length - 1);
				}
				break;
			case 'down':
				if (selectedIndex() < modelOptions().length - 1) {
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
			<text
				fg={colors.textMuted}
				content=" Use arrow keys to navigate, Enter to select, Esc to cancel"
			/>
			<text content="" style={{ height: 1 }} />
			<For each={modelOptions()}>
				{(model, i) => {
					const isSelected = () => i() === selectedIndex();
					const isCurrent = () => i() === currentModelIndex();
					return (
						<box style={{ flexDirection: 'row' }}>
							<text
								fg={isSelected() ? colors.accent : colors.text}
								content={isSelected() ? '> ' : '  '}
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
