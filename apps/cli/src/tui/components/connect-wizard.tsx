import {
	createEffect,
	createMemo,
	createSignal,
	For,
	Show,
	onMount,
	type Component,
	type Setter
} from 'solid-js';
import { useKeyboard, usePaste } from '@opentui/solid';
import { Result } from 'better-result';
import { spawn } from 'bun';

import { colors } from '../theme.ts';
import { useMessagesContext } from '../context/messages-context.tsx';
import { useConfigContext } from '../context/config-context.tsx';
import { services } from '../services.ts';
import { formatError } from '../lib/format-error.ts';
import { loginCopilotOAuth } from '../../lib/copilot-oauth.ts';
import { loginOpenAIOAuth, saveProviderApiKey } from '../../lib/opencode-oauth.ts';
import {
	CURATED_MODELS,
	PROVIDER_AUTH_GUIDANCE,
	PROVIDER_INFO,
	PROVIDER_MODEL_DOCS,
	PROVIDER_SETUP_LINKS
} from '../../connect/constants.ts';
import type { WizardStep } from '../types.ts';

type ConnectStep = 'loading' | 'provider' | 'auth' | 'api-key' | 'model' | 'model-input';

type ProviderOption = {
	id: string;
	label: string;
	connected: boolean;
};

type ModelOption = {
	id: string;
	label: string;
	kind: 'curated' | 'custom';
};

interface ConnectWizardProps {
	onClose: () => void;
	onStepChange: Setter<WizardStep>;
}

export const ConnectWizard: Component<ConnectWizardProps> = (props) => {
	const messages = useMessagesContext();
	const config = useConfigContext();

	const [step, setStep] = createSignal<ConnectStep>('loading');
	const [providerOptions, setProviderOptions] = createSignal<ProviderOption[]>([]);
	const [connectedProviders, setConnectedProviders] = createSignal<string[]>([]);
	const [modelOptions, setModelOptions] = createSignal<ModelOption[]>([]);
	const [selectedProviderIndex, setSelectedProviderIndex] = createSignal(0);
	const [selectedModelIndex, setSelectedModelIndex] = createSignal(0);
	const [selectedProviderId, setSelectedProviderId] = createSignal('');
	const [wizardInput, setWizardInput] = createSignal('');
	const [error, setError] = createSignal<string | null>(null);
	const [statusMessage, setStatusMessage] = createSignal('');
	const [busy, setBusy] = createSignal(false);

	const customModelOption: ModelOption = {
		id: '__custom__',
		label: 'Custom model ID...',
		kind: 'custom'
	};

	const sanitizePaste = (text: string) => text.replace(/[\r\n]+/g, '').trim();

	const setStepSafe = (nextStep: ConnectStep) => {
		setError(null);
		setStatusMessage('');
		setStep(nextStep);
	};

	createEffect(() => {
		const currentStep = step();
		props.onStepChange(currentStep === 'loading' ? null : (currentStep as WizardStep));
	});

	const title = createMemo(() => {
		switch (step()) {
			case 'loading':
				return 'Connect - Loading';
			case 'provider':
				return 'Connect - Select Provider';
			case 'auth':
				return 'Connect - Authenticate';
			case 'api-key':
				return 'Connect - API Key';
			case 'model':
				return 'Connect - Select Model';
			case 'model-input':
				return 'Connect - Model ID';
		}
	});

	const hint = createMemo(() => {
		const providerId = selectedProviderId();
		if (step() === 'loading') {
			return 'Loading providers...';
		}
		if (step() === 'auth') {
			return 'Complete authentication in the browser or terminal.';
		}
		if (step() === 'api-key') {
			return PROVIDER_AUTH_GUIDANCE[providerId] ?? 'Enter API key to continue.';
		}
		if (step() === 'model-input') {
			return 'Enter a model ID for this provider.';
		}
		return 'Use arrow keys to navigate, Enter to select, Esc to cancel';
	});

	const authLink = createMemo(() => {
		const providerId = selectedProviderId();
		return PROVIDER_SETUP_LINKS[providerId];
	});

	const modelDocsLink = createMemo(() => {
		const providerId = selectedProviderId();
		return PROVIDER_MODEL_DOCS[providerId];
	});

	const showModelDocsLink = createMemo(() => {
		const currentStep = step();
		return (currentStep === 'model' || currentStep === 'model-input') && Boolean(modelDocsLink());
	});

	const loadProviders = async () => {
		setStepSafe('loading');
		const result = await Result.tryPromise(() => services.getProviders());
		if (result.isErr()) {
			const message = formatError(result.error);
			messages.addSystemMessage(`Error: ${message}`);
			props.onClose();
			return;
		}

		const { connected, all } = result.value;
		const connectedSet = new Set(connected);

		const connectedOptions = connected.map((id) => {
			const info = PROVIDER_INFO[id];
			const label = info ? `${info.label} (connected)` : `${id} (connected)`;
			return { id, label, connected: true };
		});

		const unconnectedOptions = all
			.map((provider) => provider.id)
			.filter((id) => !connectedSet.has(id))
			.map((id) => {
				const info = PROVIDER_INFO[id];
				const label = info ? info.label : id;
				return { id, label, connected: false };
			});

		const options = [...connectedOptions, ...unconnectedOptions];
		setProviderOptions(options);
		setConnectedProviders(connected);

		const currentProvider = config.selectedProvider();
		const currentIndex = options.findIndex((opt) => opt.id === currentProvider);
		setSelectedProviderIndex(currentIndex >= 0 ? currentIndex : 0);

		setStepSafe('provider');
	};

	onMount(() => {
		void loadProviders();
	});

	const runOpencodeAuth = async (providerId: string) => {
		setStepSafe('auth');
		setBusy(true);
		setStatusMessage(`Opening browser for ${providerId} authentication...`);
		const result = await Result.tryPromise(async () => {
			const proc = spawn(['opencode', 'auth', '--provider', providerId], {
				stdin: 'inherit',
				stdout: 'inherit',
				stderr: 'inherit'
			});
			const exitCode = await proc.exited;
			return exitCode === 0;
		});
		setBusy(false);

		if (result.isErr() || !result.value) {
			const message = result.isErr() ? formatError(result.error) : 'Authentication failed.';
			setError(message);
			messages.addSystemMessage(`Error: ${message}`);
			setStepSafe('provider');
			return false;
		}

		return true;
	};

	const runOpenAIOAuth = async () => {
		setStepSafe('auth');
		setBusy(true);
		setStatusMessage('Starting OpenAI OAuth flow...');
		const result = await loginOpenAIOAuth();
		setBusy(false);

		if (!result.ok) {
			setError(result.error);
			messages.addSystemMessage(`Error: ${result.error}`);
			setStepSafe('provider');
			return false;
		}

		messages.addSystemMessage('OpenAI authentication complete.');
		return true;
	};

	const runCopilotOAuth = async () => {
		setStepSafe('auth');
		setBusy(true);
		setStatusMessage('Starting GitHub Copilot device flow...');
		const result = await loginCopilotOAuth();
		setBusy(false);

		if (!result.ok) {
			setError(result.error);
			messages.addSystemMessage(`Error: ${result.error}`);
			setStepSafe('provider');
			return false;
		}

		messages.addSystemMessage('GitHub Copilot authentication complete.');
		return true;
	};

	const requireAuth = async (providerId: string) => {
		if (providerId === 'github-copilot') {
			return runCopilotOAuth();
		}

		if (providerId === 'openai') {
			return runOpenAIOAuth();
		}

		if (
			providerId === 'opencode' ||
			providerId === 'openrouter' ||
			providerId === 'anthropic' ||
			providerId === 'google'
		) {
			setStepSafe('api-key');
			setWizardInput('');
			return true;
		}

		return runOpencodeAuth(providerId);
	};

	const proceedToModelSelection = async (providerId: string) => {
		const curated = CURATED_MODELS[providerId] ?? [];
		if (curated.length > 0) {
			const options: ModelOption[] = [
				...curated.map((model) => ({ ...model, kind: 'curated' as const })),
				customModelOption
			];
			const currentModel = config.selectedModel();
			const currentIndex = options.findIndex(
				(option) => option.kind === 'curated' && option.id === currentModel
			);
			setModelOptions(options);
			setSelectedModelIndex(currentIndex >= 0 ? currentIndex : 0);
			setStepSafe('model');
			return;
		}

		setWizardInput('');
		setStepSafe('model-input');
	};

	const updateModel = async (providerId: string, modelId: string) => {
		if (!providerId || !modelId || busy()) return;
		setBusy(true);
		const result = await Result.tryPromise(() => services.updateModel(providerId, modelId));
		setBusy(false);
		if (result.isErr()) {
			const message = formatError(result.error);
			setError(message);
			messages.addSystemMessage(`Error: ${message}`);
			return;
		}
		config.setProvider(result.value.provider);
		config.setModel(result.value.model);
		messages.addSystemMessage(`Model configured: ${result.value.provider}/${result.value.model}`);
		props.onClose();
	};

	const handleProviderSelect = async () => {
		if (busy()) return;
		const provider = providerOptions()[selectedProviderIndex()];
		if (!provider) return;
		setSelectedProviderId(provider.id);

		const isConnected = connectedProviders().includes(provider.id);
		const info = PROVIDER_INFO[provider.id];

		if (!isConnected && info?.requiresAuth) {
			const authReady = await requireAuth(provider.id);
			if (!authReady) return;
			if (step() === 'api-key') return;
		}

		await proceedToModelSelection(provider.id);
	};

	const handleApiKeySubmit = async () => {
		if (busy()) return;
		const providerId = selectedProviderId();
		const key = wizardInput().trim();
		if (!key) {
			setError('API key is required.');
			return;
		}
		setBusy(true);
		const result = await Result.tryPromise(() => saveProviderApiKey(providerId, key));
		setBusy(false);
		if (result.isErr()) {
			const message = formatError(result.error);
			setError(message);
			messages.addSystemMessage(`Error: ${message}`);
			return;
		}
		messages.addSystemMessage(`${providerId} API key saved.`);
		await proceedToModelSelection(providerId);
	};

	const handleModelSubmit = async () => {
		const providerId = selectedProviderId();
		const modelId = wizardInput().trim();
		if (!modelId) {
			setError('Model ID is required.');
			return;
		}
		await updateModel(providerId, modelId);
	};

	useKeyboard((key) => {
		const currentStep = step();
		if (key.name === 'escape') {
			props.onClose();
			return;
		}

		if (currentStep === 'provider') {
			switch (key.name) {
				case 'up':
					setSelectedProviderIndex((idx) =>
						idx > 0 ? idx - 1 : Math.max(providerOptions().length - 1, 0)
					);
					break;
				case 'down':
					setSelectedProviderIndex((idx) => (idx < providerOptions().length - 1 ? idx + 1 : 0));
					break;
				case 'return':
					void handleProviderSelect();
					break;
			}
			return;
		}

		if (currentStep === 'model') {
			switch (key.name) {
				case 'up':
					setSelectedModelIndex((idx) =>
						idx > 0 ? idx - 1 : Math.max(modelOptions().length - 1, 0)
					);
					break;
				case 'down':
					setSelectedModelIndex((idx) => (idx < modelOptions().length - 1 ? idx + 1 : 0));
					break;
				case 'return': {
					const selected = modelOptions()[selectedModelIndex()];
					if (selected) {
						if (selected.kind === 'custom') {
							setWizardInput('');
							setStepSafe('model-input');
							return;
						}
						void updateModel(selectedProviderId(), selected.id);
					}
					break;
				}
			}
		}
	});

	usePaste((text) => {
		const currentStep = step();
		if (currentStep !== 'api-key' && currentStep !== 'model-input') return;
		const sanitized = sanitizePaste(text.text);
		if (!sanitized) return;
		setWizardInput((prev) => `${prev}${sanitized}`);
		setError(null);
	});

	const renderProviderList = () => (
		<For each={providerOptions()}>
			{(provider, i) => {
				const isSelected = () => i() === selectedProviderIndex();
				return (
					<box style={{ flexDirection: 'row' }}>
						<text
							fg={isSelected() ? colors.accent : colors.text}
							content={isSelected() ? '> ' : '  '}
						/>
						<text fg={isSelected() ? colors.accent : colors.text} content={provider.label} />
					</box>
				);
			}}
		</For>
	);

	const renderModelList = () => (
		<For each={modelOptions()}>
			{(model, i) => {
				const isSelected = () => i() === selectedModelIndex();
				return (
					<box style={{ flexDirection: 'row' }}>
						<text
							fg={isSelected() ? colors.accent : colors.text}
							content={isSelected() ? '> ' : '  '}
						/>
						<text
							fg={isSelected() ? colors.accent : colors.text}
							content={model.label}
							style={{ width: 32 }}
						/>
						<Show when={model.kind === 'curated'}>
							<text fg={colors.textSubtle} content={` ${model.id}`} />
						</Show>
					</box>
				);
			}}
		</For>
	);

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
			<text fg={colors.accent} content={` ${title()}`} />
			<text fg={colors.textSubtle} content={` ${hint()}`} />
			<Show when={authLink()}>
				<text fg={colors.textSubtle} content={` ${authLink()!.label}: ${authLink()!.url}`} />
			</Show>
			<Show when={showModelDocsLink()}>
				<text
					fg={colors.textSubtle}
					content={` ${modelDocsLink()!.label}: ${modelDocsLink()!.url}`}
				/>
			</Show>
			<Show when={statusMessage().length > 0}>
				<text fg={colors.textMuted} content={` ${statusMessage()}`} />
			</Show>
			<Show when={error()}>
				<text fg={colors.error} content={` ${error()}`} />
			</Show>
			<text content="" style={{ height: 1 }} />

			<Show when={step() === 'provider'}>{renderProviderList()}</Show>
			<Show when={step() === 'model'}>{renderModelList()}</Show>

			<Show when={step() === 'api-key' || step() === 'model-input'}>
				<input
					placeholder={step() === 'api-key' ? 'API key' : 'model-id'}
					placeholderColor={colors.textSubtle}
					textColor={colors.text}
					value={wizardInput()}
					onInput={(value) => {
						setWizardInput(value);
						setError(null);
					}}
					onSubmit={() => {
						if (step() === 'api-key') {
							void handleApiKeySubmit();
							return;
						}
						void handleModelSubmit();
					}}
					focused
					style={{ width: '100%' }}
				/>
			</Show>

			<Show when={step() === 'loading' || step() === 'auth'}>
				<text fg={colors.textMuted} content=" Working..." />
			</Show>
		</box>
	);
};
