import { useEffect, useMemo, useState } from 'react';
import { useKeyboard } from '@opentui/react';
import { Result } from 'better-result';
import { spawn } from 'bun';

import { usePaste } from '../opentui-hooks.ts';
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

type ConnectStep =
	| 'loading'
	| 'provider'
	| 'auth'
	| 'api-key'
	| 'model'
	| 'model-input'
	| 'compat-base-url'
	| 'compat-name'
	| 'compat-model'
	| 'compat-api-key';

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
	onStepChange: (step: WizardStep) => void;
}

export const ConnectWizard = (props: ConnectWizardProps) => {
	const messages = useMessagesContext();
	const config = useConfigContext();

	const [step, setStep] = useState<ConnectStep>('loading');
	const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
	const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
	const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
	const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);
	const [selectedModelIndex, setSelectedModelIndex] = useState(0);
	const [selectedProviderId, setSelectedProviderId] = useState('');
	const [wizardInput, setWizardInput] = useState('');
	const [compatBaseUrl, setCompatBaseUrl] = useState('');
	const [compatName, setCompatName] = useState('');
	const [compatModelId, setCompatModelId] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState('');
	const [busy, setBusy] = useState(false);

	const customModelOption: ModelOption = useMemo(
		() => ({
			id: '__custom__',
			label: 'Custom model ID...',
			kind: 'custom'
		}),
		[]
	);

	const sanitizePaste = (text: string) => text.replace(/[\r\n]+/g, '').trim();

	const setStepSafe = (nextStep: ConnectStep) => {
		setError(null);
		setStatusMessage('');
		setStep(nextStep);
	};

	useEffect(() => {
		props.onStepChange(step === 'loading' ? null : (step as WizardStep));
	}, [step, props.onStepChange]);

	const title = useMemo(() => {
		switch (step) {
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
			case 'compat-base-url':
				return 'Connect - Base URL';
			case 'compat-name':
				return 'Connect - Provider Name';
			case 'compat-model':
				return 'Connect - Model ID';
			case 'compat-api-key':
				return 'Connect - API Key (Optional)';
		}
	}, [step]);

	const hint = useMemo(() => {
		const providerId = selectedProviderId;
		if (step === 'loading') return 'Loading providers...';
		if (step === 'auth') return 'Complete authentication in the browser or terminal.';
		if (step === 'api-key') {
			return PROVIDER_AUTH_GUIDANCE[providerId] ?? 'Enter API key to continue.';
		}
		if (step === 'model-input') return 'Enter a model ID for this provider.';
		if (step === 'compat-base-url')
			return 'Enter the base URL for your OpenAI-compatible provider.';
		if (step === 'compat-name') return 'Enter the provider name (used by the AI SDK).';
		if (step === 'compat-model') return 'Enter the model ID to use.';
		if (step === 'compat-api-key') return 'Enter an API key if required (optional).';
		return 'Use arrow keys to navigate, Enter to select, Esc to cancel';
	}, [step, selectedProviderId]);

	const authLink = useMemo(() => PROVIDER_SETUP_LINKS[selectedProviderId], [selectedProviderId]);
	const modelDocsLink = useMemo(
		() => PROVIDER_MODEL_DOCS[selectedProviderId],
		[selectedProviderId]
	);

	const showModelDocsLink = useMemo(() => {
		return (
			(step === 'model' ||
				step === 'model-input' ||
				step === 'compat-base-url' ||
				step === 'compat-model') &&
			Boolean(modelDocsLink)
		);
	}, [step, modelDocsLink]);

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

		const connectedOptions: ProviderOption[] = connected.map((id) => {
			const info = PROVIDER_INFO[id];
			const label = info ? `${info.label} (connected)` : `${id} (connected)`;
			return { id, label, connected: true };
		});

		const unconnectedOptions: ProviderOption[] = all
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

		const currentProvider = config.selectedProvider;
		const currentIndex = options.findIndex((opt) => opt.id === currentProvider);
		setSelectedProviderIndex(currentIndex >= 0 ? currentIndex : 0);

		setStepSafe('provider');
	};

	useEffect(() => {
		void loadProviders();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

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
			return { ok: await runCopilotOAuth(), kind: 'oauth' as const };
		}
		if (providerId === 'openai') {
			return { ok: await runOpenAIOAuth(), kind: 'oauth' as const };
		}

		if (
			providerId === 'opencode' ||
			providerId === 'openrouter' ||
			providerId === 'anthropic' ||
			providerId === 'google'
		) {
			setStepSafe('api-key');
			setWizardInput('');
			return { ok: true, kind: 'api-key' as const };
		}

		return { ok: await runOpencodeAuth(providerId), kind: 'oauth' as const };
	};

	const proceedToModelSelection = async (providerId: string) => {
		const curated = CURATED_MODELS[providerId] ?? [];
		if (curated.length > 0) {
			const options: ModelOption[] = [
				...curated.map((model) => ({ ...model, kind: 'curated' as const })),
				customModelOption
			];
			const currentModel = config.selectedModel;
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

	const updateModel = async (
		providerId: string,
		modelId: string,
		providerOptions?: { baseURL?: string; name?: string }
	) => {
		if (!providerId || !modelId || busy) return;
		setBusy(true);
		const result = await Result.tryPromise(() =>
			services.updateModel(providerId, modelId, providerOptions)
		);
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

	const startCompatSetup = () => {
		setCompatBaseUrl('');
		setCompatName('');
		setCompatModelId('');
		setWizardInput('');
		setStepSafe('compat-base-url');
	};

	const handleCompatSubmit = async () => {
		if (busy) return;
		const value = wizardInput.trim();
		const currentStep = step;

		if (currentStep === 'compat-base-url') {
			if (!value) {
				setError('Base URL is required.');
				return;
			}
			setCompatBaseUrl(value);
			setWizardInput('');
			setStepSafe('compat-name');
			return;
		}

		if (currentStep === 'compat-name') {
			if (!value) {
				setError('Provider name is required.');
				return;
			}
			setCompatName(value);
			setWizardInput('');
			setStepSafe('compat-model');
			return;
		}

		if (currentStep === 'compat-model') {
			if (!value) {
				setError('Model ID is required.');
				return;
			}
			setCompatModelId(value);
			setWizardInput('');
			setStepSafe('compat-api-key');
			return;
		}

		if (currentStep === 'compat-api-key') {
			const providerId = selectedProviderId;
			if (value) {
				setBusy(true);
				const result = await Result.tryPromise(() => saveProviderApiKey(providerId, value));
				setBusy(false);
				if (result.isErr()) {
					const message = formatError(result.error);
					setError(message);
					messages.addSystemMessage(`Error: ${message}`);
					return;
				}
				messages.addSystemMessage(`${providerId} API key saved.`);
			}

			await updateModel(providerId, compatModelId, {
				baseURL: compatBaseUrl,
				name: compatName
			});
		}
	};

	const handleProviderSelect = async () => {
		if (busy) return;
		const provider = providerOptions[selectedProviderIndex];
		if (!provider) return;
		setSelectedProviderId(provider.id);

		if (provider.id === 'openai-compat') {
			startCompatSetup();
			return;
		}

		const isConnected = connectedProviders.includes(provider.id);
		const info = PROVIDER_INFO[provider.id];

		if (!isConnected && info?.requiresAuth) {
			const authResult = await requireAuth(provider.id);
			if (!authResult.ok) return;
			if (authResult.kind === 'api-key') return;
		}

		await proceedToModelSelection(provider.id);
	};

	const handleApiKeySubmit = async () => {
		if (busy) return;
		const providerId = selectedProviderId;
		const key = wizardInput.trim();
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
		const providerId = selectedProviderId;
		const modelId = wizardInput.trim();
		if (!modelId) {
			setError('Model ID is required.');
			return;
		}
		await updateModel(providerId, modelId);
	};

	useKeyboard((key) => {
		const currentStep = step;
		if (key.name === 'escape') {
			props.onClose();
			return;
		}

		if (currentStep === 'provider') {
			switch (key.name) {
				case 'up':
					setSelectedProviderIndex((idx) =>
						idx > 0 ? idx - 1 : Math.max(providerOptions.length - 1, 0)
					);
					break;
				case 'down':
					setSelectedProviderIndex((idx) => (idx < providerOptions.length - 1 ? idx + 1 : 0));
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
						idx > 0 ? idx - 1 : Math.max(modelOptions.length - 1, 0)
					);
					break;
				case 'down':
					setSelectedModelIndex((idx) => (idx < modelOptions.length - 1 ? idx + 1 : 0));
					break;
				case 'return': {
					const selected = modelOptions[selectedModelIndex];
					if (!selected) break;
					if (selected.kind === 'custom') {
						setWizardInput('');
						setStepSafe('model-input');
						return;
					}
					void updateModel(selectedProviderId, selected.id);
					break;
				}
			}
		}
	});

	usePaste((event) => {
		if (
			step !== 'api-key' &&
			step !== 'model-input' &&
			step !== 'compat-base-url' &&
			step !== 'compat-name' &&
			step !== 'compat-model' &&
			step !== 'compat-api-key'
		) {
			return;
		}
		const sanitized = sanitizePaste(event.text);
		if (!sanitized) return;
		setWizardInput((prev) => `${prev}${sanitized}`);
		setError(null);
	});

	const isInputStep =
		step === 'api-key' ||
		step === 'model-input' ||
		step === 'compat-base-url' ||
		step === 'compat-name' ||
		step === 'compat-model' ||
		step === 'compat-api-key';

	const inputPlaceholder = () => {
		switch (step) {
			case 'api-key':
				return 'API key';
			case 'model-input':
				return 'model-id';
			case 'compat-base-url':
				return 'base-url';
			case 'compat-name':
				return 'provider-name';
			case 'compat-model':
				return 'model-id';
			case 'compat-api-key':
				return 'api-key (optional)';
			default:
				return '';
		}
	};

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
			<text fg={colors.accent} content={` ${title}`} />
			<text fg={colors.textSubtle} content={` ${hint}`} />
			{authLink ? (
				<text fg={colors.textSubtle} content={` ${authLink.label}: ${authLink.url}`} />
			) : null}
			{showModelDocsLink && modelDocsLink ? (
				<text fg={colors.textSubtle} content={` ${modelDocsLink.label}: ${modelDocsLink.url}`} />
			) : null}
			{statusMessage.length > 0 ? (
				<text fg={colors.textMuted} content={` ${statusMessage}`} />
			) : null}
			{error ? <text fg={colors.error} content={` ${error}`} /> : null}
			<text content="" style={{ height: 1 }} />

			{step === 'provider'
				? providerOptions.map((provider, i) => {
						const isSelected = i === selectedProviderIndex;
						const providerColor = provider.connected
							? colors.success
							: isSelected
								? colors.accent
								: colors.text;
						return (
							<box key={provider.id} style={{ flexDirection: 'row' }}>
								<text
									fg={isSelected ? colors.accent : colors.text}
									content={isSelected ? '> ' : '  '}
								/>
								<text fg={providerColor} content={provider.label} />
							</box>
						);
					})
				: null}

			{step === 'model'
				? modelOptions.map((model, i) => {
						const isSelected = i === selectedModelIndex;
						return (
							<box key={model.id} style={{ flexDirection: 'row' }}>
								<text
									fg={isSelected ? colors.accent : colors.text}
									content={isSelected ? '> ' : '  '}
								/>
								<text
									fg={isSelected ? colors.accent : colors.text}
									content={model.label}
									style={{ width: 32 }}
								/>
								{model.kind === 'curated' ? (
									<text fg={colors.textSubtle} content={` ${model.id}`} />
								) : null}
							</box>
						);
					})
				: null}

			{isInputStep ? (
				<input
					placeholder={inputPlaceholder()}
					placeholderColor={colors.textSubtle}
					textColor={colors.text}
					value={wizardInput}
					onInput={(value) => {
						setWizardInput(value);
						setError(null);
					}}
					onSubmit={() => {
						if (step === 'api-key') {
							void handleApiKeySubmit();
							return;
						}
						if (step === 'model-input') {
							void handleModelSubmit();
							return;
						}
						void handleCompatSubmit();
					}}
					focused
					style={{ width: '100%' }}
				/>
			) : null}

			{step === 'loading' || step === 'auth' ? (
				<text fg={colors.textMuted} content=" Working..." />
			) : null}
		</box>
	);
};
