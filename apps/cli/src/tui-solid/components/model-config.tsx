import { createEffect, createSignal, Show, type Component, type Setter } from 'solid-js';
import { colors } from '../theme.ts';
import { useKeyboard, usePaste } from '@opentui/solid';
import { useConfigContext } from '../context/config-context.tsx';
import { useMessagesContext } from '../context/messages-context.tsx';
import { services } from '../services.ts';
import type { WizardStep } from './input-section.tsx';

type ModelConfigStep = 'provider' | 'model' | 'confirm';

const STEP_INFO: Record<ModelConfigStep, { title: string; hint: string; placeholder: string }> = {
	provider: {
		title: 'Step 1/2: Provider',
		hint: 'Enter provider ID (e.g., "opencode", "anthropic", "openai")',
		placeholder: 'opencode'
	},
	model: {
		title: 'Step 2/2: Model',
		hint: 'Enter model ID (e.g., "big-pickle", "claude-sonnet-4-20250514")',
		placeholder: 'big-pickle'
	},
	confirm: {
		title: 'Confirm',
		hint: 'Press Enter to save, Esc to cancel',
		placeholder: ''
	}
};

// Track if we just opened the modal to prevent the same keypress from triggering submit
let justOpened = false;

interface ModelConfigProps {
	onClose: () => void;
	onStepChange: Setter<WizardStep>;
}

export const ModelConfig: Component<ModelConfigProps> = (props) => {
	const config = useConfigContext();
	const messages = useMessagesContext();

	// All state is LOCAL
	const [step, setStep] = createSignal<ModelConfigStep>('provider');
	const [values, setValues] = createSignal({
		provider: config.selectedProvider(),
		model: config.selectedModel()
	});
	const [modelInput, setModelInput] = createSignal(config.selectedProvider());

	const info = () => STEP_INFO[step()];

	// Notify parent of step changes for status bar
	createEffect(() => {
		props.onStepChange(step());
	});

	// Reset justOpened flag when component mounts
	createEffect(() => {
		justOpened = true;
		setTimeout(() => {
			justOpened = false;
		}, 0);
	});

	useKeyboard((key) => {
		if (key.name === 'c' && key.ctrl) {
			if (modelInput().length === 0) {
				props.onClose();
			} else {
				setModelInput('');
			}
		}
	});

	usePaste(({ text }) => {
		const currentStep = step();
		if (currentStep === 'provider' || currentStep === 'model') {
			setModelInput(text.trim());
		}
	});

	const handleSubmit = async () => {
		// Skip if this is the same keypress that opened the modal
		if (justOpened) return;
		const currentStep = step();
		const value = modelInput().trim();

		if (currentStep === 'provider') {
			if (!value) return;
			setValues({ ...values(), provider: value });
			setStep('model');
			setModelInput(config.selectedModel());
		} else if (currentStep === 'model') {
			if (!value) return;
			setValues({ ...values(), model: value });
			setStep('confirm');
		} else if (currentStep === 'confirm') {
			const vals = values();
			try {
				const result = await services.updateModel(vals.provider, vals.model);
				config.setProvider(result.provider);
				config.setModel(result.model);
				messages.addSystemMessage(`Model updated: ${result.provider}/${result.model}`);
			} catch (error) {
				messages.addSystemMessage(`Error: ${error}`);
			} finally {
				props.onClose();
			}
		}
	};

	useKeyboard((key) => {
		if (key.name === 'escape') {
			props.onClose();
		} else if (key.name === 'return' && step() === 'confirm') {
			handleSubmit();
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
				borderColor: colors.info,
				flexDirection: 'column',
				padding: 1
			}}
		>
			<text fg={colors.info} content={` Configure Model - ${info().title}`} />
			<text fg={colors.textSubtle} content={` ${info().hint}`} />
			<text content="" style={{ height: 1 }} />

			<Show
				when={step() === 'confirm'}
				fallback={
					<box style={{}}>
						<input
							placeholder={info().placeholder}
							placeholderColor={colors.textSubtle}
							textColor={colors.text}
							value={modelInput()}
							onInput={setModelInput}
							onSubmit={handleSubmit}
							focused
							style={{ width: '100%' }}
						/>
					</box>
				}
			>
				<box style={{ flexDirection: 'column', paddingLeft: 1 }}>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="Provider: " style={{ width: 12 }} />
						<text fg={colors.text} content={values().provider} />
					</box>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="Model:    " style={{ width: 12 }} />
						<text fg={colors.text} content={values().model} />
					</box>
					<text content="" style={{ height: 1 }} />
					<text fg={colors.success} content=" Press Enter to confirm, Esc to cancel" />
				</box>
			</Show>
		</box>
	);
};
