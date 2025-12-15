import type { Colors } from '../theme.ts';

export type ModelConfigStep = 'provider' | 'model' | 'confirm';

interface ModelConfigProps {
	step: ModelConfigStep;
	values: {
		provider: string;
		model: string;
	};
	currentInput: string;
	onInput: (value: string) => void;
	onSubmit: () => void;
	colors: Colors;
}

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

export function ModelConfig({
	step,
	values,
	currentInput,
	onInput,
	onSubmit,
	colors
}: ModelConfigProps) {
	const info = STEP_INFO[step];

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
			<text fg={colors.info} content={` Configure Model - ${info.title}`} />
			<text fg={colors.textSubtle} content={` ${info.hint}`} />
			<text content="" style={{ height: 1 }} />

			{step === 'confirm' ? (
				<box style={{ flexDirection: 'column', paddingLeft: 1 }}>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="Provider: " style={{ width: 12 }} />
						<text fg={colors.text} content={values.provider} />
					</box>
					<box style={{ flexDirection: 'row' }}>
						<text fg={colors.textMuted} content="Model:    " style={{ width: 12 }} />
						<text fg={colors.text} content={values.model} />
					</box>
					<text content="" style={{ height: 1 }} />
					<text fg={colors.success} content=" Press Enter to confirm, Esc to cancel" />
				</box>
			) : (
				<box style={{}}>
					<input
						placeholder={info.placeholder}
						placeholderColor={colors.textSubtle}
						textColor={colors.text}
						value={currentInput}
						onInput={onInput}
						onSubmit={onSubmit}
						focused
						style={{ width: '100%' }}
					/>
				</box>
			)}
		</box>
	);
}
