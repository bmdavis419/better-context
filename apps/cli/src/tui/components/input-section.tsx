import { createSignal, createMemo, Show, onMount, type Component } from 'solid-js';
import type { TextareaRenderable } from '@opentui/core';
import { useKeyboard } from '@opentui/solid';
import type { InputState, ActiveWizard, WizardStep } from '../types.ts';
import { useMessagesContext } from '../context/messages-context.tsx';
import { useConfigContext } from '../context/config-context.tsx';
import { MainInput } from './main-input.tsx';
import { StatusBar } from './status-bar.tsx';
import { CommandPalette } from './command-palette.tsx';
import { RepoMentionPalette } from './repo-mention-palette.tsx';
import { ConnectWizard } from './connect-wizard.tsx';
import { AddResourceWizard } from './add-resource-wizard.tsx';
import { ResumeThreadModal } from './resume-thread-modal.tsx';
import { inputHistory } from '../history.ts';

export const InputSection: Component = () => {
	const messages = useMessagesContext();
	const config = useConfigContext();

	// Input state - all local
	const [inputState, setInputState] = createSignal<InputState>([]);
	const [cursorPosition, setCursorPosition] = createSignal(0);
	const [inputRef, setInputRef] = createSignal<TextareaRenderable | null>(null);

	// Wizard visibility
	const [activeWizard, setActiveWizard] = createSignal<ActiveWizard>('none');
	const [currentWizardStep, setCurrentWizardStep] = createSignal<WizardStep>(null);

	const isAnyWizardOpen = () => activeWizard() !== 'none';

	// Initialize input history on mount
	onMount(() => {
		inputHistory.init();
	});

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

	// Parse @mentions from input
	const parseAllMentions = (input: string) => {
		const mentionRegex = /@([A-Za-z0-9@._/-]+)/g;
		const repos: string[] = [];
		let match;
		while ((match = mentionRegex.exec(input)) !== null) {
			repos.push(match[1]!);
		}
		const question = input.replace(mentionRegex, '').trim().replace(/\s+/g, ' ');
		return { repos: [...new Set(repos)], question };
	};

	const resolveRepoName = (input: string): string | null => {
		const available = config.repos();
		const target = input.toLowerCase();
		const direct = available.find((r) => r.name.toLowerCase() === target);
		if (direct) return direct.name;

		if (target.startsWith('@')) {
			const withoutAt = target.slice(1);
			const match = available.find((r) => r.name.toLowerCase() === withoutAt);
			return match?.name ?? null;
		}

		const withAt = `@${target}`;
		const match = available.find((r) => r.name.toLowerCase() === withAt);
		return match?.name ?? null;
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
		const existingResources = messages.threadResources();

		// Validate resources - require at least one @mention OR existing thread resources
		if (parsed.repos.length === 0 && existingResources.length === 0) {
			messages.addSystemMessage('Use @resource to add context. Example: @svelte How do I...?');
			return;
		}
		if (!parsed.question.trim()) {
			messages.addSystemMessage('Please enter a question after the @mention.');
			return;
		}

		// Validate any new repos exist
		const validNewRepos: string[] = [];
		const invalidRepos: string[] = [];
		for (const repoName of parsed.repos) {
			const resolved = resolveRepoName(repoName);
			if (resolved) validNewRepos.push(resolved);
			else invalidRepos.push(repoName);
		}
		if (invalidRepos.length > 0) {
			messages.addSystemMessage(
				`Resource(s) not found: ${invalidRepos.join(', ')}. Configure resources with "btca add".`
			);
			return;
		}

		// Save to history before clearing (preserves full InputState including pasted blocks)
		const currentInput = inputState();
		await inputHistory.add(currentInput);

		// Clear input and send (pass only new repos - context will merge with existing)
		setInputState([]);
		await messages.send(currentInput, validNewRepos);
	};

	const closeWizard = () => {
		setActiveWizard('none');
		setCurrentWizardStep(null);
	};

	const handleCommandExecute = (command: { mode: string }) => {
		setInputState([]);
		switch (command.mode) {
			case 'connect':
				setActiveWizard('connect');
				setCurrentWizardStep('provider');
				break;
			case 'add-repo':
				setActiveWizard('add-repo');
				setCurrentWizardStep('type');
				break;
			case 'clear':
				messages.clearMessages();
				messages.addSystemMessage('Chat cleared.');
				break;
			case 'resume':
				if (messages.isStreaming()) {
					messages.addSystemMessage('Cannot resume while streaming.');
					return;
				}
				setActiveWizard('resume');
				break;
		}
	};

	// Helper to set input from history entry (now receives full InputState)
	const setInputFromHistory = (entry: InputState | null) => {
		if (entry === null) return;
		// Set the full InputState directly, preserving pasted blocks
		setInputState(entry);
		// Move cursor to end
		queueMicrotask(() => {
			const ref = inputRef();
			if (ref) {
				ref.gotoBufferEnd();
				const cursor = ref.logicalCursor;
				setCursorPosition(cursor.col);
			}
		});
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
				inputHistory.reset();
			}
		}
		// Up arrow - navigate to previous history entry
		if (
			key.name === 'up' &&
			!isAnyWizardOpen() &&
			!messages.isStreaming() &&
			cursorIsCurrentlyIn() !== 'command' &&
			cursorIsCurrentlyIn() !== 'mention'
		) {
			const entry = inputHistory.navigateUp(inputState());
			setInputFromHistory(entry);
		}
		// Down arrow - navigate to next history entry
		if (
			key.name === 'down' &&
			!isAnyWizardOpen() &&
			!messages.isStreaming() &&
			cursorIsCurrentlyIn() !== 'command' &&
			cursorIsCurrentlyIn() !== 'mention'
		) {
			const entry = inputHistory.navigateDown();
			setInputFromHistory(entry);
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
			<Show when={activeWizard() === 'connect'}>
				<ConnectWizard onClose={closeWizard} onStepChange={setCurrentWizardStep} />
			</Show>
			<Show when={activeWizard() === 'add-repo'}>
				<AddResourceWizard onClose={closeWizard} onStepChange={setCurrentWizardStep} />
			</Show>
			<Show when={activeWizard() === 'resume'}>
				<ResumeThreadModal
					onClose={closeWizard}
					onSelect={async (threadId) => {
						await messages.resumeThread(threadId);
						closeWizard();
					}}
				/>
			</Show>

			<StatusBar
				cursorIn={cursorIsCurrentlyIn()}
				isStreaming={messages.isStreaming()}
				cancelState={messages.cancelState()}
				threadResources={messages.threadResources()}
				activeWizard={activeWizard()}
				wizardStep={currentWizardStep()}
			/>
		</>
	);
};
