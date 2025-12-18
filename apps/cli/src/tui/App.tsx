import { useKeyboard } from '@opentui/react';
import { useState, useMemo, useEffect, useRef } from 'react';
import type { InputRenderable } from '@opentui/core';
import { colors } from './theme.ts';
import { filterCommands } from './commands.ts';
import { services } from './services.ts';
import { copyToClipboard } from './clipboard.ts';
import type { Mode, Message, Repo, Command } from './types.ts';
import type { WizardStep } from './components/AddRepoWizard.tsx';
import type { ModelConfigStep } from './components/ModelConfig.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';
import { AddRepoWizard } from './components/AddRepoWizard.tsx';
import { RemoveRepoPrompt } from './components/RemoveRepoPrompt.tsx';
import { ModelConfig } from './components/ModelConfig.tsx';

declare const __VERSION__: string;
const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

const parseAtMention = (
	input: string
): { repoQuery: string; question: string; hasSpace: boolean } | null => {
	if (!input.startsWith('@')) return null;
	const spaceIndex = input.indexOf(' ');
	if (spaceIndex === -1) {
		return { repoQuery: input.slice(1), question: '', hasSpace: false };
	}
	return {
		repoQuery: input.slice(1, spaceIndex),
		question: input.slice(spaceIndex + 1),
		hasSpace: true
	};
};

export function App() {
	const [repos, setRepos] = useState<Repo[]>([]);
	const [messages, setMessages] = useState<Message[]>([]);
	const [modelConfig, setModelConfig] = useState({ provider: '', model: '' });

	const [mode, setMode] = useState<Mode>('chat');
	const [inputValue, setInputValue] = useState('');
	const [commandIndex, setCommandIndex] = useState(0);

	const [repoMentionIndex, setRepoMentionIndex] = useState(0);

	const inputRef = useRef<InputRenderable>(null);

	const [wizardStep, setWizardStep] = useState<WizardStep>('name');
	const [wizardValues, setWizardValues] = useState({
		name: '',
		url: '',
		branch: '',
		notes: ''
	});
	const [wizardInput, setWizardInput] = useState('');

	const [modelStep, setModelStep] = useState<ModelConfigStep>('provider');
	const [modelValues, setModelValues] = useState({ provider: '', model: '' });
	const [modelInput, setModelInput] = useState('');

	const [removeRepoName, setRemoveRepoName] = useState('');

	const [isLoading, setIsLoading] = useState(false);
	const [loadingText, setLoadingText] = useState('');

	useEffect(() => {
		services.getRepos().then(setRepos).catch(console.error);
		services.getModel().then(setModelConfig).catch(console.error);
	}, []);

	const showCommandPalette = mode === 'chat' && inputValue.startsWith('/');
	const commandQuery = inputValue.slice(1);
	const filteredCommands = useMemo(() => filterCommands(commandQuery), [commandQuery]);
	const clampedCommandIndex = Math.min(commandIndex, Math.max(0, filteredCommands.length - 1));

	const atMention = useMemo(() => parseAtMention(inputValue), [inputValue]);
	const showRepoMentionPalette = mode === 'chat' && atMention !== null && !atMention.hasSpace;
	const filteredMentionRepos = useMemo(() => {
		if (!atMention) return [];
		const query = atMention.repoQuery.toLowerCase();
		return repos.filter((repo) => repo.name.toLowerCase().includes(query));
	}, [repos, atMention]);
	const clampedRepoMentionIndex = Math.min(
		repoMentionIndex,
		Math.max(0, filteredMentionRepos.length - 1)
	);

	const handleInputChange = (value: string) => {
		setInputValue(value);
		setCommandIndex(0);
		setRepoMentionIndex(0);
	};

	const executeCommand = async (command: Command) => {
		setInputValue('');
		setCommandIndex(0);

		if (command.mode === 'add-repo') {
			setMode('add-repo');
			setWizardStep('name');
			setWizardValues({ name: '', url: '', branch: '', notes: '' });
			setWizardInput('');
		} else if (command.mode === 'clear') {
			setMessages([]);
			setMessages((prev) => [...prev, { role: 'system', content: 'Chat cleared.' }]);
		} else if (command.mode === 'remove-repo') {
			if (repos.length === 0) {
				setMessages((prev) => [...prev, { role: 'system', content: 'No repos to remove' }]);
				return;
			}
			setRemoveRepoName('');
			setMode('remove-repo');
		} else if (command.mode === 'config-model') {
			setMode('config-model');
			setModelStep('provider');
			setModelValues({ provider: modelConfig.provider, model: modelConfig.model });
			setModelInput(modelConfig.provider);
		} else if (command.mode === 'chat') {
			setMessages((prev) => [
				...prev,
				{
					role: 'system',
					content: 'Use @reponame to start a chat. Example: @daytona How do I...?'
				}
			]);
		} else if (command.mode === 'ask') {
			setMessages((prev) => [
				...prev,
				{
					role: 'system',
					content: 'Use @reponame to ask a question. Example: @daytona What is...?'
				}
			]);
		}
	};

	const selectRepoMention = () => {
		const selectedRepo = filteredMentionRepos[clampedRepoMentionIndex];
		if (!selectedRepo) return;
		const newValue = `@${selectedRepo.name} `;
		setInputValue(newValue);
		setRepoMentionIndex(0);
		setTimeout(() => {
			if (inputRef.current) {
				inputRef.current.cursorPosition = newValue.length;
			}
		}, 0);
	};

	const handleChatSubmit = async () => {
		const value = inputValue.trim();
		if (!value) return;

		if (showCommandPalette && filteredCommands.length > 0) {
			const command = filteredCommands[clampedCommandIndex];
			if (command) {
				executeCommand(command);
				return;
			}
		}

		if (showRepoMentionPalette && filteredMentionRepos.length > 0) {
			selectRepoMention();
			return;
		}

		if (isLoading) return;

		const mention = parseAtMention(value);
		if (!mention || !mention.question.trim()) {
			setMessages((prev) => [
				...prev,
				{
					role: 'system',
					content: 'Use @reponame followed by your question. Example: @daytona How do I...?'
				}
			]);
			return;
		}

		const targetRepo = repos.find((r) => r.name.toLowerCase() === mention.repoQuery.toLowerCase());
		if (!targetRepo) {
			setMessages((prev) => [
				...prev,
				{
					role: 'system',
					content: `Repo "${mention.repoQuery}" not found. Use /add to add a repo.`
				}
			]);
			return;
		}

		setMessages((prev) => [
			...prev,
			{ role: 'user', content: `@${targetRepo.name} ${mention.question}` }
		]);
		setInputValue('');
		setIsLoading(true);
		setMode('loading');
		setLoadingText('');

		let fullResponse = '';

		try {
			await services.askQuestion(targetRepo.name, mention.question, (event) => {
				if (
					event.type === 'message.part.updated' &&
					'part' in event.properties &&
					event.properties.part?.type === 'text'
				) {
					const delta = (event.properties as { delta?: string }).delta ?? '';
					fullResponse += delta;
					setLoadingText(fullResponse);
				}
			});

			await copyToClipboard(fullResponse);

			setMessages((prev) => [
				...prev,
				{ role: 'assistant', content: fullResponse },
				{ role: 'system', content: 'Answer copied to clipboard!' }
			]);
		} catch (error) {
			setMessages((prev) => [...prev, { role: 'system', content: `Error: ${error}` }]);
		} finally {
			setIsLoading(false);
			setMode('chat');
			setLoadingText('');
		}
	};

	const handleWizardSubmit = () => {
		const value = wizardInput.trim();

		if (wizardStep === 'name') {
			if (!value) return;
			setWizardValues((prev) => ({ ...prev, name: value }));
			setWizardStep('url');
			setWizardInput('');
		} else if (wizardStep === 'url') {
			if (!value) return;
			setWizardValues((prev) => ({ ...prev, url: value }));
			setWizardStep('branch');
			setWizardInput('main');
		} else if (wizardStep === 'branch') {
			setWizardValues((prev) => ({ ...prev, branch: value || 'main' }));
			setWizardStep('notes');
			setWizardInput('');
		} else if (wizardStep === 'notes') {
			setWizardValues((prev) => ({ ...prev, notes: value }));
			setWizardStep('confirm');
		} else if (wizardStep === 'confirm') {
			const newRepo: Repo = {
				name: wizardValues.name,
				url: wizardValues.url,
				branch: wizardValues.branch || 'main',
				...(wizardValues.notes && { specialNotes: wizardValues.notes })
			};

			services
				.addRepo(newRepo)
				.then(() => {
					setRepos((prev) => [...prev, newRepo]);
					setMessages((prev) => [
						...prev,
						{ role: 'system', content: `Added repo: ${newRepo.name}` }
					]);
				})
				.catch((error) => {
					setMessages((prev) => [...prev, { role: 'system', content: `Error: ${error}` }]);
				})
				.finally(() => {
					setMode('chat');
				});
		}
	};

	const handleModelSubmit = () => {
		const value = modelInput.trim();

		if (modelStep === 'provider') {
			if (!value) return;
			setModelValues((prev) => ({ ...prev, provider: value }));
			setModelStep('model');
			setModelInput(modelConfig.model);
		} else if (modelStep === 'model') {
			if (!value) return;
			setModelValues((prev) => ({ ...prev, model: value }));
			setModelStep('confirm');
		} else if (modelStep === 'confirm') {
			services
				.updateModel(modelValues.provider, modelValues.model)
				.then((result) => {
					setModelConfig(result);
					setMessages((prev) => [
						...prev,
						{
							role: 'system',
							content: `Model updated: ${result.provider}/${result.model}`
						}
					]);
				})
				.catch((error) => {
					setMessages((prev) => [...prev, { role: 'system', content: `Error: ${error}` }]);
				})
				.finally(() => {
					setMode('chat');
				});
		}
	};

	const handleRemoveRepo = async (repoName: string) => {
		try {
			await services.removeRepo(repoName);
			setRepos((prev) => prev.filter((r) => r.name !== repoName));
			setMessages((prev) => [...prev, { role: 'system', content: `Removed repo: ${repoName}` }]);
		} catch (error) {
			setMessages((prev) => [...prev, { role: 'system', content: `Error: ${error}` }]);
		} finally {
			setMode('chat');
			setRemoveRepoName('');
		}
	};

	const cancelMode = () => {
		setMode('chat');
		setInputValue('');
		setWizardInput('');
		setModelInput('');
		setRemoveRepoName('');
	};

	useKeyboard((key) => {
		if (key.name === 'escape') {
			key.preventDefault();
			if (mode !== 'chat' && mode !== 'loading') {
				cancelMode();
			} else if (showCommandPalette || showRepoMentionPalette) {
				setInputValue('');
			}
			return;
		}

		if (mode === 'chat' && showCommandPalette) {
			if (key.name === 'up') {
				key.preventDefault();
				setCommandIndex((prev) => (prev === 0 ? filteredCommands.length - 1 : prev - 1));
			} else if (key.name === 'down') {
				key.preventDefault();
				setCommandIndex((prev) => (prev === filteredCommands.length - 1 ? 0 : prev + 1));
			}
		} else if (mode === 'chat' && showRepoMentionPalette) {
			if (key.name === 'up') {
				key.preventDefault();
				setRepoMentionIndex((prev) => (prev === 0 ? filteredMentionRepos.length - 1 : prev - 1));
			} else if (key.name === 'down') {
				key.preventDefault();
				setRepoMentionIndex((prev) => (prev === filteredMentionRepos.length - 1 ? 0 : prev + 1));
			} else if (key.name === 'tab') {
				key.preventDefault();
				selectRepoMention();
			}
		} else if (mode === 'remove-repo') {
			if (key.name === 'y' || key.name === 'Y') {
				key.preventDefault();
				if (removeRepoName) {
					handleRemoveRepo(removeRepoName);
				}
			} else if (key.name === 'n' || key.name === 'N') {
				key.preventDefault();
				cancelMode();
			}
		} else if (mode === 'add-repo' && wizardStep === 'confirm') {
			if (key.name === 'return') {
				key.preventDefault();
				handleWizardSubmit();
			}
		} else if (mode === 'config-model' && modelStep === 'confirm') {
			if (key.name === 'return') {
				key.preventDefault();
				handleModelSubmit();
			}
		}
	});

	return (
		<box
			width="100%"
			height="100%"
			style={{
				flexDirection: 'column',
				backgroundColor: colors.bg
			}}
		>
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
					<span fg={colors.accent}>{'◆'}</span>
					<span fg={colors.text}>{' btca'}</span>
					<span fg={colors.textMuted}>{' - The Better Context App'}</span>
				</text>
				<text fg={colors.textSubtle} content={`${modelConfig.provider}/${modelConfig.model}`} />
			</box>

			<box
				style={{
					flexDirection: 'row',
					flexGrow: 1,
					width: '100%'
				}}
			>
				<box
					style={{
						flexGrow: 1,
						backgroundColor: colors.bg,
						border: true,
						borderColor: colors.border,
						flexDirection: 'column',
						padding: 1
					}}
				>
					<text fg={colors.textMuted} content=" Chat" />
					<text content="" style={{ height: 1 }} />
					{messages.map((msg, i) => (
						<box key={i} style={{ flexDirection: 'column', marginBottom: 1 }}>
							<text
								fg={
									msg.role === 'user'
										? colors.accent
										: msg.role === 'system'
											? colors.info
											: colors.success
								}
							>
								{msg.role === 'user' ? 'You ' : msg.role === 'system' ? 'SYS ' : 'AI  '}
							</text>
							<text fg={colors.text} content={`    ${msg.content}`} />
						</box>
					))}
					{mode === 'loading' && (
						<box style={{ flexDirection: 'column', marginBottom: 1 }}>
							<text fg={colors.success}>{'AI  '}</text>
							<text fg={colors.text} content={`    ${loadingText || 'Thinking...'}`} />
						</box>
					)}
				</box>
			</box>

			{showCommandPalette && (
				<CommandPalette
					commands={filteredCommands}
					selectedIndex={clampedCommandIndex}
					colors={colors}
				/>
			)}

			{showRepoMentionPalette && filteredMentionRepos.length > 0 && (
				<box
					style={{
						position: 'absolute',
						bottom: 5,
						left: 1,
						width: 40,
						backgroundColor: colors.bgSubtle,
						border: true,
						borderColor: colors.accent,
						flexDirection: 'column',
						padding: 1
					}}
				>
					<text fg={colors.textMuted} content=" Select repo:" />
					{(() => {
						const maxVisible = 8;
						const start = Math.max(
							0,
							Math.min(
								clampedRepoMentionIndex - Math.floor(maxVisible / 2),
								filteredMentionRepos.length - maxVisible
							)
						);
						const visibleRepos = filteredMentionRepos.slice(start, start + maxVisible);
						return visibleRepos.map((repo, i) => {
							const actualIndex = start + i;
							return (
								<text
									key={repo.name}
									fg={actualIndex === clampedRepoMentionIndex ? colors.accent : colors.text}
									content={
										actualIndex === clampedRepoMentionIndex ? `▸ @${repo.name}` : `  @${repo.name}`
									}
								/>
							);
						});
					})()}
				</box>
			)}

			{mode === 'add-repo' && (
				<AddRepoWizard
					step={wizardStep}
					values={wizardValues}
					currentInput={wizardInput}
					onInput={setWizardInput}
					onSubmit={handleWizardSubmit}
					colors={colors}
				/>
			)}

			{mode === 'remove-repo' && !removeRepoName && (
				<box
					style={{
						position: 'absolute',
						top: '50%',
						left: '50%',
						width: 50,
						backgroundColor: colors.bgSubtle,
						border: true,
						borderColor: colors.error,
						flexDirection: 'column',
						padding: 2
					}}
				>
					<text fg={colors.error} content=" Remove Repo" />
					<text content="" style={{ height: 1 }} />
					<text fg={colors.text} content=" Type repo name to remove:" />
					<text content="" style={{ height: 1 }} />
					{repos.map((repo) => (
						<text key={repo.name} fg={colors.textSubtle} content={`  @${repo.name}`} />
					))}
					<text content="" style={{ height: 1 }} />
					<input
						placeholder="repo name"
						placeholderColor={colors.textSubtle}
						textColor={colors.text}
						value={removeRepoName}
						onInput={setRemoveRepoName}
						onSubmit={() => {
							const repo = repos.find((r) => r.name.toLowerCase() === removeRepoName.toLowerCase());
							if (repo) {
								setRemoveRepoName(repo.name);
							}
						}}
						focused={true}
						style={{ height: 1, width: '100%', marginTop: 1 }}
					/>
				</box>
			)}

			{mode === 'remove-repo' && removeRepoName && (
				<RemoveRepoPrompt repoName={removeRepoName} colors={colors} />
			)}

			{mode === 'config-model' && (
				<ModelConfig
					step={modelStep}
					values={modelValues}
					currentInput={modelInput}
					onInput={setModelInput}
					onSubmit={handleModelSubmit}
					colors={colors}
				/>
			)}

			<box
				style={{
					border: true,
					borderColor: mode === 'loading' ? colors.textMuted : colors.accent,
					height: 3,
					width: '100%',
					paddingLeft: 1,
					paddingRight: 1
				}}
			>
				<input
					ref={inputRef}
					placeholder={
						mode === 'loading' ? 'Please wait...' : '@repo question... or / for commands'
					}
					placeholderColor={colors.textSubtle}
					backgroundColor={colors.bg}
					textColor={colors.text}
					value={inputValue}
					onInput={handleInputChange}
					onSubmit={handleChatSubmit}
					focused={mode === 'chat'}
					style={{
						height: '100%',
						width: '100%'
					}}
				/>
			</box>

			<box
				style={{
					height: 1,
					width: '100%',
					backgroundColor: colors.bgMuted,
					flexDirection: 'row',
					justifyContent: 'space-between',
					paddingLeft: 1,
					paddingRight: 1
				}}
			>
				<text
					fg={colors.textSubtle}
					content={
						mode === 'loading'
							? ' Streaming response...'
							: showCommandPalette
								? ' [Up/Down] Navigate  [Enter] Select  [Esc] Cancel'
								: showRepoMentionPalette
									? ' [Up/Down] Navigate  [Tab/Enter] Select  [Esc] Cancel'
									: mode === 'add-repo'
										? wizardStep === 'confirm'
											? ' [Enter] Confirm  [Esc] Cancel'
											: ' [Enter] Next  [Esc] Cancel'
										: mode === 'remove-repo'
											? removeRepoName
												? ' [Y] Yes  [N/Esc] Cancel'
												: ' [Enter] Select  [Esc] Cancel'
											: mode === 'config-model'
												? modelStep === 'confirm'
													? ' [Enter] Confirm  [Esc] Cancel'
													: ' [Enter] Next  [Esc] Cancel'
												: ' [@repo] Ask question  [/] Commands  [Ctrl+C] Quit'
					}
				/>
				<text fg={colors.textSubtle} content={`v${VERSION}`} />
			</box>
		</box>
	);
}
