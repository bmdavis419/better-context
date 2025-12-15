import { useKeyboard } from '@opentui/react';
import { useState, useMemo, useEffect } from 'react';
import { colors } from './theme.ts';
import { filterCommands } from './commands.ts';
import { services } from './services.ts';
import { copyToClipboard } from './clipboard.ts';
import type { Mode, Message, Repo, Command } from './types.ts';
import type { WizardStep } from './components/AddRepoWizard.tsx';
import type { ModelConfigStep } from './components/ModelConfig.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';
import { RepoSelector } from './components/RepoSelector.tsx';
import { AddRepoWizard } from './components/AddRepoWizard.tsx';
import { RemoveRepoPrompt } from './components/RemoveRepoPrompt.tsx';
import { ModelConfig } from './components/ModelConfig.tsx';

declare const __VERSION__: string;
const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

export function App() {
	// Core state
	const [repos, setRepos] = useState<Repo[]>([]);
	const [selectedRepo, setSelectedRepo] = useState(0);
	const [messages, setMessages] = useState<Message[]>([]);
	const [modelConfig, setModelConfig] = useState({ provider: '', model: '' });

	// Mode and input state
	const [mode, setMode] = useState<Mode>('chat');
	const [inputValue, setInputValue] = useState('');
	const [commandIndex, setCommandIndex] = useState(0);

	// Repo selector state
	const [repoSelectorIndex, setRepoSelectorIndex] = useState(0);
	const [repoSearchQuery, setRepoSearchQuery] = useState('');

	// Add repo wizard state
	const [wizardStep, setWizardStep] = useState<WizardStep>('name');
	const [wizardValues, setWizardValues] = useState({
		name: '',
		url: '',
		branch: '',
		notes: ''
	});
	const [wizardInput, setWizardInput] = useState('');

	// Model config state
	const [modelStep, setModelStep] = useState<ModelConfigStep>('provider');
	const [modelValues, setModelValues] = useState({ provider: '', model: '' });
	const [modelInput, setModelInput] = useState('');

	// Loading state for ask command
	const [isLoading, setIsLoading] = useState(false);
	const [loadingText, setLoadingText] = useState('');

	// Load initial data
	useEffect(() => {
		services.getRepos().then(setRepos).catch(console.error);
		services.getModel().then(setModelConfig).catch(console.error);
	}, []);

	// Derived state
	const showCommandPalette = mode === 'chat' && inputValue.startsWith('/');
	const commandQuery = inputValue.slice(1);
	const filteredCommands = useMemo(() => filterCommands(commandQuery), [commandQuery]);
	const clampedCommandIndex = Math.min(commandIndex, Math.max(0, filteredCommands.length - 1));

	// Filtered repos for search
	const filteredRepos = useMemo(() => {
		if (!repoSearchQuery) return repos;
		const query = repoSearchQuery.toLowerCase();
		return repos.filter((repo) => repo.name.toLowerCase().includes(query));
	}, [repos, repoSearchQuery]);
	const clampedRepoIndex = Math.min(repoSelectorIndex, Math.max(0, filteredRepos.length - 1));

	const handleInputChange = (value: string) => {
		setInputValue(value);
		setCommandIndex(0);
	};

	const executeCommand = async (command: Command) => {
		setInputValue('');
		setCommandIndex(0);

		if (command.mode === 'add-repo') {
			setMode('add-repo');
			setWizardStep('name');
			setWizardValues({ name: '', url: '', branch: '', notes: '' });
			setWizardInput('');
		} else if (command.mode === 'select-repo') {
			setMode('select-repo');
			setRepoSelectorIndex(selectedRepo);
			setRepoSearchQuery('');
		} else if (command.mode === 'clear') {
			// Clear chat history
			setMessages([]);
			setMessages((prev) => [...prev, { role: 'system', content: 'Chat cleared.' }]);
		} else if (command.mode === 'remove-repo') {
			if (repos.length === 0) {
				setMessages((prev) => [...prev, { role: 'system', content: 'No repos to remove' }]);
				return;
			}
			setMode('remove-repo');
		} else if (command.mode === 'config-model') {
			setMode('config-model');
			setModelStep('provider');
			setModelValues({ provider: modelConfig.provider, model: modelConfig.model });
			setModelInput(modelConfig.provider);
		} else if (command.mode === 'chat') {
			// Spawn OpenCode chat
			if (repos.length === 0) {
				setMessages((prev) => [
					...prev,
					{ role: 'system', content: 'No repos configured. Use /add to add a repo first.' }
				]);
				return;
			}
			const repoName = repos[selectedRepo]?.name;
			if (!repoName) return;

			setMessages((prev) => [
				...prev,
				{ role: 'system', content: `Starting chat session for ${repoName}...` }
			]);

			try {
				await services.spawnTui(repoName);
				// After OpenCode exits, we're back in the TUI
				setMessages((prev) => [
					...prev,
					{ role: 'system', content: 'Chat session ended. Welcome back!' }
				]);
			} catch (error) {
				setMessages((prev) => [...prev, { role: 'system', content: `Error: ${error}` }]);
			}
		} else if (command.mode === 'ask') {
			// Ask mode - next input will be the question
			if (repos.length === 0) {
				setMessages((prev) => [
					...prev,
					{ role: 'system', content: 'No repos configured. Use /add to add a repo first.' }
				]);
				return;
			}
			setMessages((prev) => [
				...prev,
				{ role: 'system', content: 'Enter your question and press Enter:' }
			]);
			// Stay in chat mode, next submit will be the question
			setInputValue('');
		}
	};

	const handleChatSubmit = async () => {
		const value = inputValue.trim();
		if (!value) return;

		// If showing command palette, execute selected command
		if (showCommandPalette && filteredCommands.length > 0) {
			const command = filteredCommands[clampedCommandIndex];
			if (command) {
				executeCommand(command);
				return;
			}
		}

		// If loading, ignore input
		if (isLoading) return;

		// Check if this is a question (after /ask was used)
		// Or if user just types a regular message, treat it as a question
		const repoName = repos[selectedRepo]?.name;
		if (!repoName) {
			setMessages((prev) => [
				...prev,
				{ role: 'system', content: 'No repo selected. Use /add to add a repo first.' }
			]);
			setInputValue('');
			return;
		}

		// Treat any non-command input as a question
		setMessages((prev) => [...prev, { role: 'user', content: value }]);
		setInputValue('');
		setIsLoading(true);
		setMode('loading');
		setLoadingText('');

		let fullResponse = '';

		try {
			await services.askQuestion(repoName, value, (event) => {
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

			// Copy to clipboard
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

	// Wizard handlers
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
			// Submit the repo
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

	// Model config handlers
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

	const handleSelectRepo = () => {
		// Find the actual repo index in the original repos array
		const selectedRepoFromFiltered = filteredRepos[clampedRepoIndex];
		if (!selectedRepoFromFiltered) return;

		const actualIndex = repos.findIndex((r) => r.name === selectedRepoFromFiltered.name);
		if (actualIndex === -1) return;

		setSelectedRepo(actualIndex);
		setMessages((prev) => [
			...prev,
			{ role: 'system', content: `Switched to repo: ${selectedRepoFromFiltered.name}` }
		]);
		setRepoSearchQuery('');
		setMode('chat');
	};

	const handleRemoveRepo = async () => {
		const repoName = repos[selectedRepo]?.name;
		if (!repoName) return;

		try {
			await services.removeRepo(repoName);
			setRepos((prev) => prev.filter((r) => r.name !== repoName));
			const newRepos = repos.filter((r) => r.name !== repoName);
			setRepos(newRepos);
			if (selectedRepo >= newRepos.length) {
				setSelectedRepo(Math.max(0, newRepos.length - 1));
			}
			setMessages((prev) => [...prev, { role: 'system', content: `Removed repo: ${repoName}` }]);
		} catch (error) {
			setMessages((prev) => [...prev, { role: 'system', content: `Error: ${error}` }]);
		} finally {
			setMode('chat');
		}
	};

	const cancelMode = () => {
		setMode('chat');
		setInputValue('');
		setWizardInput('');
		setModelInput('');
		setRepoSearchQuery('');
	};

	useKeyboard((key) => {
		// Escape always cancels current mode
		if (key.name === 'escape') {
			key.preventDefault();
			if (mode !== 'chat' && mode !== 'loading') {
				cancelMode();
			} else if (showCommandPalette) {
				setInputValue('');
			}
			return;
		}

		// Mode-specific keyboard handling
		if (mode === 'chat' && showCommandPalette) {
			if (key.name === 'up') {
				key.preventDefault();
				setCommandIndex((prev) => (prev === 0 ? filteredCommands.length - 1 : prev - 1));
			} else if (key.name === 'down') {
				key.preventDefault();
				setCommandIndex((prev) => (prev === filteredCommands.length - 1 ? 0 : prev + 1));
			}
		} else if (mode === 'select-repo') {
			if (key.name === 'up') {
				key.preventDefault();
				setRepoSelectorIndex((prev) => (prev === 0 ? filteredRepos.length - 1 : prev - 1));
			} else if (key.name === 'down') {
				key.preventDefault();
				setRepoSelectorIndex((prev) => (prev === filteredRepos.length - 1 ? 0 : prev + 1));
			} else if (key.name === 'return') {
				key.preventDefault();
				handleSelectRepo();
			} else if (key.name === 'backspace') {
				key.preventDefault();
				setRepoSearchQuery((prev) => prev.slice(0, -1));
				setRepoSelectorIndex(0);
			} else if (key.sequence && key.sequence.length === 1 && /[a-zA-Z0-9-_]/.test(key.sequence)) {
				// Typing a letter/number filters the list
				key.preventDefault();
				setRepoSearchQuery((prev) => prev + key.sequence);
				setRepoSelectorIndex(0);
			}
		} else if (mode === 'remove-repo') {
			if (key.name === 'y' || key.name === 'Y') {
				key.preventDefault();
				handleRemoveRepo();
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

	const currentRepoName = repos[selectedRepo]?.name ?? 'No repo selected';

	return (
		<box
			width="100%"
			height="100%"
			style={{
				flexDirection: 'column',
				backgroundColor: colors.bg
			}}
		>
			{/* Header */}
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

			{/* Content area */}
			<box
				style={{
					flexDirection: 'row',
					flexGrow: 1,
					width: '100%'
				}}
			>
				{/* Sidebar */}
				<box
					style={{
						width: 28,
						backgroundColor: colors.bgSubtle,
						border: true,
						borderColor: colors.border,
						flexDirection: 'column',
						padding: 1
					}}
				>
					<text fg={colors.textMuted} content=" Repos" />
					<text content="" style={{ height: 1 }} />
					{repos.length === 0 ? (
						<text fg={colors.textSubtle} content="  No repos" />
					) : (
						repos.map((repo, i) => (
							<text
								key={repo.name}
								fg={i === selectedRepo ? colors.accent : colors.textSubtle}
								content={i === selectedRepo ? `▸ ${repo.name}` : `  ${repo.name}`}
							/>
						))
					)}
				</box>

				{/* Chat area */}
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
					<text fg={colors.textMuted} content={` Chat - ${currentRepoName}`} />
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

			{/* Overlays */}
			{showCommandPalette && (
				<CommandPalette
					commands={filteredCommands}
					selectedIndex={clampedCommandIndex}
					colors={colors}
				/>
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

			{mode === 'select-repo' && (
				<RepoSelector
					repos={filteredRepos}
					selectedIndex={clampedRepoIndex}
					currentRepo={selectedRepo}
					searchQuery={repoSearchQuery}
					colors={colors}
				/>
			)}

			{mode === 'remove-repo' && (
				<RemoveRepoPrompt repoName={repos[selectedRepo]?.name ?? ''} colors={colors} />
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

			{/* Input area */}
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
					placeholder={
						mode === 'loading' ? 'Please wait...' : 'Ask a question or / for commands...'
					}
					placeholderColor={colors.textSubtle}
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

			{/* Status bar */}
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
								: mode === 'add-repo'
									? wizardStep === 'confirm'
										? ' [Enter] Confirm  [Esc] Cancel'
										: ' [Enter] Next  [Esc] Cancel'
									: mode === 'select-repo'
										? ' Type to search  [Up/Down] Navigate  [Enter] Select  [Esc] Cancel'
										: mode === 'remove-repo'
											? ' [Y] Yes  [N/Esc] Cancel'
											: mode === 'config-model'
												? modelStep === 'confirm'
													? ' [Enter] Confirm  [Esc] Cancel'
													: ' [Enter] Next  [Esc] Cancel'
												: ' [/] Commands  [Enter] Ask  [Ctrl+C] Quit'
					}
				/>
				<text fg={colors.textSubtle} content={`v${VERSION}`} />
			</box>
		</box>
	);
}
