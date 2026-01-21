import { createMemo, createSignal, type Component } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { colors } from '../theme.ts';
import { useMessagesContext } from '../context/messages-context.tsx';
import { setAuth } from '../../opencode/auth-store.ts';
import { saveCodexAuth, startCodexOAuth } from '../../opencode/codex-auth.ts';

const PROVIDER_LABELS: Record<string, { label: string; description: string }> = {
	opencode: {
		label: 'OpenCode Zen',
		description: 'Shared API key for multiple models.'
	},
	openai: {
		label: 'OpenAI',
		description: 'ChatGPT Pro/Plus OAuth for Codex models.'
	},
	anthropic: {
		label: 'Anthropic',
		description: 'Bring your Anthropic API key.'
	},
	'github-copilot': {
		label: 'GitHub Copilot',
		description: 'Authenticate with your GitHub account.'
	},
	google: {
		label: 'Google',
		description: 'Use Google AI models with your credentials.'
	},
	openrouter: {
		label: 'OpenRouter',
		description: 'Use your OpenRouter API key.'
	},
	vercel: {
		label: 'Vercel AI Gateway',
		description: 'Route models through Vercel AI Gateway.'
	}
};

interface ProviderOption {
	id: string;
	label: string;
	description: string;
}

type ConnectStep = 'provider' | 'method' | 'api-key' | 'oauth';

interface ConnectProviderWizardProps {
	onClose: () => void;
	onShowModels?: () => void;
}

export const ConnectProviderWizard: Component<ConnectProviderWizardProps> = (props) => {
	const messages = useMessagesContext();
	const [step, setStep] = createSignal<ConnectStep>('provider');
	const [selectedIndex, setSelectedIndex] = createSignal(0);
	const [selectedProvider, setSelectedProvider] = createSignal<string | null>(null);
	const [selectedMethod, setSelectedMethod] = createSignal(0);
	const [apiKey, setApiKey] = createSignal('');
	const [oauthUrl, setOauthUrl] = createSignal<string | null>(null);
	let oauthCancel: (() => void) | null = null;

	const providerOptions: ProviderOption[] = Object.entries(PROVIDER_LABELS)
		.map(([id, meta]) => ({ id, label: meta.label, description: meta.description }))
		.sort((a, b) => a.label.localeCompare(b.label));

	const methodOptions = createMemo(() => {
		if (selectedProvider() !== 'openai') return [];
		return [
			{ id: 'oauth', label: 'ChatGPT Pro/Plus (OAuth)' },
			{ id: 'api', label: 'Manually enter API key' }
		];
	});

	const startOAuth = async () => {
		setOauthUrl(null);
		const { url, wait, cancel } = await startCodexOAuth();
		oauthCancel = cancel;
		setOauthUrl(url);
		try {
			const auth = await wait;
			await saveCodexAuth(auth);
			messages.addSystemMessage('OpenAI connected via OAuth.');
			props.onClose();
			props.onShowModels?.();
		} catch (error) {
			messages.addSystemMessage(
				`OpenAI OAuth failed: ${error instanceof Error ? error.message : String(error)}`
			);
			setStep('method');
		}
	};

	const copyUrl = (url: string) => {
		const tryCopy = (cmd: string[]) => {
			try {
				if (!Bun.which(cmd[0] ?? '')) return false;
				const proc = Bun.spawn({ cmd, stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' });
				proc.stdin?.write(url);
				proc.stdin?.end();
				return true;
			} catch {
				return false;
			}
		};

		if (process.platform === 'darwin' && tryCopy(['pbcopy'])) return true;
		if (process.env.WSL_DISTRO_NAME && tryCopy(['clip.exe'])) return true;
		if (tryCopy(['wl-copy'])) return true;
		if (tryCopy(['xclip', '-selection', 'clipboard'])) return true;
		if (tryCopy(['xsel', '--clipboard', '--input'])) return true;
		messages.addSystemMessage('Copy failed. Use the URL shown in the prompt.');
		return false;
	};

	const truncateUrl = (url: string) =>
		url.length > 88 ? `${url.slice(0, 44)}...${url.slice(-36)}` : url;

	const saveApiKey = async () => {
		const provider = selectedProvider();
		const key = apiKey().trim();
		if (!provider || !key) return;
		await setAuth(provider, { type: 'api', key });
		messages.addSystemMessage(`Saved API key for ${provider}.`);
		props.onClose();
		if (provider === 'openai') {
			props.onShowModels?.();
		}
	};

	useKeyboard((key) => {
		if (key.name === 'escape') {
			props.onClose();
			return;
		}

		if (step() === 'provider') {
			const list = providerOptions;
			if (list.length === 0) return;
			switch (key.name) {
				case 'up':
					setSelectedIndex(selectedIndex() > 0 ? selectedIndex() - 1 : list.length - 1);
					break;
				case 'down':
					setSelectedIndex(selectedIndex() < list.length - 1 ? selectedIndex() + 1 : 0);
					break;
				case 'return': {
					const selection = list[selectedIndex()];
					if (selection) {
						setSelectedProvider(selection.id);
						setSelectedIndex(0);
						if (selection.id === 'openai') {
							setStep('method');
						} else {
							setStep('api-key');
						}
					}
					break;
				}
				default:
					break;
			}
			return;
		}

		if (step() === 'method') {
			const list = methodOptions();
			switch (key.name) {
				case 'up':
					setSelectedMethod(selectedMethod() > 0 ? selectedMethod() - 1 : list.length - 1);
					break;
				case 'down':
					setSelectedMethod(selectedMethod() < list.length - 1 ? selectedMethod() + 1 : 0);
					break;
				case 'return': {
					const method = list[selectedMethod()];
					if (!method) return;
					if (method.id === 'oauth') {
						setStep('oauth');
						void startOAuth();
					} else {
						setStep('api-key');
					}
					break;
				}
				default:
					break;
			}
			return;
		}

		if (step() === 'api-key') {
			if (key.name === 'return') {
				void saveApiKey();
			}
			return;
		}

		if (step() === 'oauth') {
			if (key.name === 'escape') {
				oauthCancel?.();
				setStep('method');
				return;
			}
			if (key.name === 'c') {
				const url = oauthUrl();
				if (url && copyUrl(url)) {
					messages.addSystemMessage('Copied OAuth URL to clipboard.');
				}
			}
		}
	});

	const renderBody = () => {
		if (step() === 'provider') {
			if (providerOptions.length === 0) {
				return [<text fg={colors.textMuted} content=" No providers available." />];
			}
			return providerOptions.map((provider, index) => {
				const isSelected = () => index === selectedIndex();
				return (
					<box
						style={{ flexDirection: 'row' }}
						children={[
							<text
								fg={isSelected() ? colors.accent : colors.text}
								content={isSelected() ? '> ' : '  '}
							/>,
							<text
								fg={isSelected() ? colors.accent : colors.text}
								content={provider.label}
								style={{ width: 22 }}
							/>,
							<text fg={colors.textSubtle} content={provider.description} />
						]}
					/>
				);
			});
		}

		if (step() === 'method') {
			const list = methodOptions();
			return list.map((method, index) => {
				const isSelected = () => index === selectedMethod();
				return (
					<box
						style={{ flexDirection: 'row' }}
						children={[
							<text
								fg={isSelected() ? colors.accent : colors.text}
								content={isSelected() ? '> ' : '  '}
							/>,
							<text fg={isSelected() ? colors.accent : colors.text} content={method.label} />
						]}
					/>
				);
			});
		}

		if (step() === 'oauth') {
			return [
				<text fg={colors.textMuted} content=" Waiting for authorization..." />,
				...(oauthUrl()
					? [
							<text fg={colors.textSubtle} content=" Press c to copy link" />,
							<text fg={colors.textSubtle} content={` ${truncateUrl(oauthUrl()!)}`} />
						]
					: [])
			];
		}

		return [
			<box
				style={{ flexDirection: 'column', gap: 1 }}
				children={[
					<text fg={colors.textMuted} content=" Enter API key" />,
					<input
						placeholder="sk-..."
						placeholderColor={colors.textSubtle}
						textColor={colors.text}
						value={apiKey()}
						onInput={(value) => setApiKey(value)}
						onSubmit={saveApiKey}
						focused
						style={{ width: '100%' }}
					/>
				]}
			/>
		];
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
			children={[
				<text
					fg={colors.accent}
					content={
						step() === 'provider'
							? ' Connect Provider'
							: step() === 'method'
								? ' OpenAI Login Method'
								: step() === 'oauth'
									? ' OpenAI OAuth'
									: ' API Key'
					}
				/>,
				<text
					fg={colors.textMuted}
					content={
						step() === 'oauth'
							? ' Complete authorization in your browser (Esc to cancel)'
							: ' Use arrow keys to navigate, Enter to continue, Esc to cancel'
					}
				/>,
				<text content="" style={{ height: 1 }} />,
				...renderBody()
			]}
		/>
	);
};
