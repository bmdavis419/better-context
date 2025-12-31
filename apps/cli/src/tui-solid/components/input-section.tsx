import { createSignal, createMemo, Show, type Component, type Setter } from 'solid-js';
import type { TextareaRenderable } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import type { InputState, CancelState } from '../types.ts';
import { useMessagesContext } from '../context/messages-context.tsx';
import { useConfigContext } from '../context/config-context.tsx';
import { MainInput } from './main-input.tsx';
import { StatusBar } from './status-bar.tsx';
import { CommandPalette } from './command-palette.tsx';
import { RepoMentionPalette } from './repo-mention-palette.tsx';
import { AddResourceWizard } from './add-resource-wizard.tsx';
import { RemoveRepoPrompt } from './remove-repo-prompt.tsx';
import { ModelConfig } from './model-config.tsx';
import { BlessedModelSelect } from './blessed-model-select.tsx';

export type ActiveWizard = 'none' | 'add-repo' | 'remove-repo' | 'config-model' | 'blessed-model';
export type WizardStep =
	| 'name'
	| 'url'
	| 'branch'
	| 'notes'
	| 'confirm'
	| 'provider'
	| 'model'
	| null;

export const InputSection: Component = () => {
	const messages = useMessagesContext();
	const config = useConfigContext();

	// Input state - all local
	const [inputState, setInputState] = createSignal<InputState>([]);
	const [cursorPosition, setCursorPosition] = createSignal(0);
	const [inputRef, setInputRef] = createSignal<TextareaRenderable | null>(null);

	// Wizard visibility
	const [activeWizard, setActiveWizard] = createSignal<ActiveWizard>('none');

	// Wizard step tracking (for status bar)
	const [currentWizardStep, setCurrentWizardStep] = createSignal<WizardStep>(null);

	// For remove repo confirm prompt
	const [hasRemoveConfirmPrompt, setHasRemoveConfirmPrompt] = createSignal(false);

	// Computed: what type of content is cursor in
	const cursorIsCurrentlyIn = createMemo(() => {
		const items = inputState();
		let minIdx = 0;
		for (const item of items) {
			const displayLen =
				item.type === 'pasted' ? `[~${item.lines} lines]`.length : item.content.length;
			const maxIdx = minIdx + displayLen;
			if (cursorPosition() >= minIdx && cursorPosition() <= maxIdx) return item.type;
			minIdx = maxIdx;
		}
		return 'text';
	});

	const isAnyWizardOpen = () => activeWizard() !== 'none';

	// Parse @mentions from input
	const parseAllMentions = (input: string) => {
		const mentionRegex = /@(\w+)/g;
		const repos: string[] = [];
		let match;
		while ((match = mentionRegex.exec(input)) !== null) {
			repos.push(match[1]!);
		}
		const question = input.replace(mentionRegex, '').trim().replace(/\s+/g, ' ');
		return { repos: [...new Set(repos)], question };
	};

	const handleSubmit = async () => {
		const inputText = inputState()
			.map((s) => s.content)
			.join('')
			.trim();
		if (!inputText) return;
		if (cursorIsCurrentlyIn() === 'command' || cursorIsCurrentlyIn() === 'mention') return;
		if (messages.isStreaming()) return;

		const parsed = parseAllMentions(inputText);
		const thread = messages.currentThread();

		// Validate resources
		if (parsed.repos.length === 0 && (!thread || thread.resources.length === 0)) {
			messages.addSystemMessage('Use @reponame to add context. Example: @svelte How do I...?');
			return;
		}
		if (!parsed.question.trim()) {
			messages.addSystemMessage('Please enter a question after the @mention.');
			return;
		}

		// Validate repos exist
		const availableRepos = config.repos();
		const validRepos: string[] = [];
		const invalidRepos: string[] = [];
		for (const repoName of parsed.repos) {
			const found = availableRepos.find((r) => r.name.toLowerCase() === repoName.toLowerCase());
			if (found) validRepos.push(found.name);
			else invalidRepos.push(repoName);
		}
		if (invalidRepos.length > 0) {
			messages.addSystemMessage(
				`Repo(s) not found: ${invalidRepos.join(', ')}. Use /add to add a repo.`
			);
			return;
		}

		// Get all resources (existing + new)
		const existingResources = thread?.resources ?? [];
		const allResources = [...new Set([...existingResources, ...validRepos])];

		// Clear input and send
		const currentInput = inputState();
		setInputState([]);
		await messages.send(currentInput, validRepos, allResources);
	};

	const handleCommandExecute = (command: { mode: string }) => {
		setInputState([]);
		switch (command.mode) {
			case 'add-repo':
				setActiveWizard('add-repo');
				setCurrentWizardStep('name');
				break;
			case 'remove-repo':
				if (config.repos().length === 0) {
					messages.addSystemMessage('No repos to remove');
					return;
				}
				setActiveWizard('remove-repo');
				setHasRemoveConfirmPrompt(false);
				break;
			case 'config-model':
				setActiveWizard('config-model');
				setCurrentWizardStep('provider');
				break;
			case 'select-blessed-model':
				setActiveWizard('blessed-model');
				break;
			case 'clear':
				messages.clearMessages();
				messages.addSystemMessage('Chat cleared.');
				break;
		}
	};

	const closeWizard = () => {
		setActiveWizard('none');
		setCurrentWizardStep(null);
		setHasRemoveConfirmPrompt(false);
	};

	// Keyboard handling for ESC cancel flow and submit
	useKeyboard((key) => {
		if (key.name === 'escape') {
			if (messages.isStreaming()) {
				if (messages.cancelState() === 'none') {
					messages.requestCancel();
				} else {
					messages.confirmCancel();
				}
				return;
			}
			if (isAnyWizardOpen()) {
				closeWizard();
				return;
			}
			if (cursorIsCurrentlyIn() === 'command' || cursorIsCurrentlyIn() === 'mention') {
				setInputState([]);
			}
		}
		if (key.name === 'return' && !isAnyWizardOpen() && !messages.isStreaming()) {
			if (cursorIsCurrentlyIn() === 'text' || cursorIsCurrentlyIn() === 'pasted') {
				handleSubmit();
			}
		}
		// Ctrl+C handling
		if (key.name === 'c' && key.ctrl) {
			if (inputState().length > 0) {
				setInputState([]);
			}
		}
	});

	return (
		<>
			<MainInput
				inputState={inputState()}
				setInputState={setInputState}
				cursorPosition={cursorPosition()}
				setCursorPosition={setCursorPosition}
				inputRef={inputRef()}
				setInputRef={setInputRef}
				focused={!isAnyWizardOpen() && !messages.isStreaming()}
				isStreaming={messages.isStreaming()}
				cancelState={messages.cancelState()}
				currentThread={messages.currentThread()}
			/>

			{/* Palettes */}
			<Show
				when={cursorIsCurrentlyIn() === 'mention' && !isAnyWizardOpen() && !messages.isStreaming()}
			>
				<RepoMentionPalette
					inputState={inputState()}
					setInputState={setInputState}
					inputRef={inputRef()}
					cursorPosition={cursorPosition()}
				/>
			</Show>
			<Show
				when={cursorIsCurrentlyIn() === 'command' && !isAnyWizardOpen() && !messages.isStreaming()}
			>
				<CommandPalette
					inputState={inputState()}
					setInputState={setInputState}
					inputRef={inputRef()}
					onExecute={handleCommandExecute}
				/>
			</Show>

			{/* Wizards */}
			<Show when={activeWizard() === 'add-repo'}>
				<AddResourceWizard onClose={closeWizard} onStepChange={setCurrentWizardStep} />
			</Show>
			<Show when={activeWizard() === 'remove-repo'}>
				<RemoveRepoPrompt onClose={closeWizard} onConfirmPromptChange={setHasRemoveConfirmPrompt} />
			</Show>
			<Show when={activeWizard() === 'config-model'}>
				<ModelConfig onClose={closeWizard} onStepChange={setCurrentWizardStep} />
			</Show>
			<Show when={activeWizard() === 'blessed-model'}>
				<BlessedModelSelect onClose={closeWizard} />
			</Show>

			<StatusBar
				activeWizard={activeWizard()}
				wizardStep={currentWizardStep()}
				cursorIn={cursorIsCurrentlyIn()}
				isStreaming={messages.isStreaming()}
				cancelState={messages.cancelState()}
				hasConfirmPrompt={hasRemoveConfirmPrompt()}
			/>
		</>
	);
};
