import { useEffect, useMemo, useState } from 'react';
import type { TextareaRenderable } from '@opentui/core';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';

import type { ActiveWizard, InputState, WizardStep } from '../types.ts';
import { inputHistory } from '../history.ts';
import { useConfigContext } from '../context/config-context.tsx';
import { useMessagesContext } from '../context/messages-context.tsx';
import { AddResourceWizard } from './add-resource-wizard.tsx';
import { CommandPalette } from './command-palette.tsx';
import { ConnectWizard } from './connect-wizard.tsx';
import { MainInput } from './main-input.tsx';
import { RepoMentionPalette } from './repo-mention-palette.tsx';
import { ResumeThreadModal } from './resume-thread-modal.tsx';
import { StatusBar } from './status-bar.tsx';

export const InputSection = () => {
	const messages = useMessagesContext();
	const config = useConfigContext();
	const terminalDimensions = useTerminalDimensions();
	const renderer = useRenderer();

	const [inputState, setInputState] = useState<InputState>([]);
	const [cursorPosition, setCursorPosition] = useState(0);
	const [inputRef, setInputRef] = useState<TextareaRenderable | null>(null);

	const [activeWizard, setActiveWizard] = useState<ActiveWizard>('none');
	const [currentWizardStep, setCurrentWizardStep] = useState<WizardStep>(null);

	const isAnyWizardOpen = activeWizard !== 'none';

	useEffect(() => {
		inputHistory.init();
	}, []);

	const cursorIsCurrentlyIn = useMemo(() => {
		let minIdx = 0;
		for (const item of inputState) {
			const displayLen =
				item.type === 'pasted' ? `[~${item.lines} lines]`.length : item.content.length;
			const maxIdx = minIdx + displayLen;
			if (cursorPosition >= minIdx && cursorPosition <= maxIdx) return item.type;
			minIdx = maxIdx;
		}
		return 'text';
	}, [inputState, cursorPosition]);

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
		const available = config.repos;
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

	const currentInputIndex = useMemo(() => {
		let minIdx = 0;
		for (let i = 0; i < inputState.length; i++) {
			const item = inputState[i]!;
			const maxIdx =
				minIdx + (item.type === 'pasted' ? `[~${item.lines} lines]`.length : item.content.length);
			if (cursorPosition >= minIdx && cursorPosition <= maxIdx) {
				return i;
			}
			minIdx = maxIdx;
		}
		return inputState.length;
	}, [inputState, cursorPosition]);

	const currentMentionToken = useMemo(() => {
		if (cursorIsCurrentlyIn !== 'mention' || currentInputIndex >= inputState.length) return '';
		const currentInput = inputState[currentInputIndex];
		if (!currentInput || currentInput.type !== 'mention') return '';
		return currentInput.content;
	}, [cursorIsCurrentlyIn, currentInputIndex, inputState]);

	const isCurrentMentionResolved = useMemo(
		() => resolveRepoName(currentMentionToken) !== null && cursorIsCurrentlyIn === 'mention',
		[currentMentionToken, cursorIsCurrentlyIn, resolveRepoName]
	);

	const maxResumeThreadItems = useMemo(() => {
		const inputHeight = 3; // default from MainInput when empty
		const headerHeight = 3;
		const statusBarHeight = 1;
		const messagesHeight = Math.max(
			1,
			terminalDimensions.height - headerHeight - statusBarHeight - inputHeight
		);
		const modalHeight = Math.max(8, Math.floor(messagesHeight / 2));
		return Math.max(1, modalHeight - 3);
	}, [terminalDimensions.height]);

	const handleSubmit = async () => {
		const inputText = inputState
			.map((s) => s.content)
			.join('')
			.trim();
		if (!inputText) return;
		if (
			cursorIsCurrentlyIn === 'command' ||
			(cursorIsCurrentlyIn === 'mention' && !isCurrentMentionResolved)
		)
			return;
		if (messages.isStreaming) return;

		const parsed = parseAllMentions(inputText);
		const existingResources = messages.threadResources;

		if (parsed.repos.length === 0 && existingResources.length === 0) {
			messages.addSystemMessage('Use @reponame to add context. Example: @svelte How do I...?');
			return;
		}
		if (!parsed.question.trim()) {
			messages.addSystemMessage('Please enter a question after the @mention.');
			return;
		}

		const validNewRepos: string[] = [];
		const invalidRepos: string[] = [];
		for (const repoName of parsed.repos) {
			const resolved = resolveRepoName(repoName);
			if (resolved) validNewRepos.push(resolved);
			else invalidRepos.push(repoName);
		}
		if (invalidRepos.length > 0) {
			messages.addSystemMessage(
				`Repo(s) not found: ${invalidRepos.join(', ')}. Configure resources with "btca add".`
			);
			return;
		}

		const currentInput = inputState;
		await inputHistory.add(currentInput);

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
				if (messages.isStreaming) {
					messages.addSystemMessage('Cannot resume while streaming.');
					return;
				}
				setActiveWizard('resume');
				break;
		}
	};

	const setInputFromHistory = (entry: InputState | null) => {
		if (entry === null) return;
		setInputState(entry);
		queueMicrotask(() => {
			if (!inputRef) return;
			inputRef.gotoBufferEnd();
			const cursor = inputRef.logicalCursor;
			setCursorPosition(cursor.col);
		});
	};

	useKeyboard((key) => {
		if (key.name === 'escape') {
			if (messages.isStreaming) {
				if (messages.cancelState === 'none') {
					messages.requestCancel();
				} else {
					void messages.confirmCancel();
				}
				return;
			}
			if (isAnyWizardOpen) {
				closeWizard();
				return;
			}
			if (cursorIsCurrentlyIn === 'command' || cursorIsCurrentlyIn === 'mention') {
				setInputState([]);
			}
		}

		if (key.name === 'return' && !isAnyWizardOpen && !messages.isStreaming) {
			if (
				cursorIsCurrentlyIn === 'text' ||
				cursorIsCurrentlyIn === 'pasted' ||
				(cursorIsCurrentlyIn === 'mention' && isCurrentMentionResolved)
			) {
				void handleSubmit();
			}
		}

		if (key.name === 'c' && key.ctrl) {
			if (inputState.length > 0) {
				setInputState([]);
				inputHistory.reset();
				setCursorPosition(0);
				if (inputRef) {
					inputRef.setText('');
					inputRef.editBuffer.setCursor(0, 0);
				}
			} else {
				globalThis.__BTCA_SERVER__?.stop();
				renderer.destroy();
			}
		}

		if (
			key.name === 'up' &&
			!isAnyWizardOpen &&
			!messages.isStreaming &&
			cursorIsCurrentlyIn !== 'command' &&
			(cursorIsCurrentlyIn !== 'mention' || isCurrentMentionResolved)
		) {
			const entry = inputHistory.navigateUp(inputState);
			setInputFromHistory(entry);
		}

		if (
			key.name === 'down' &&
			!isAnyWizardOpen &&
			!messages.isStreaming &&
			cursorIsCurrentlyIn !== 'command' &&
			(cursorIsCurrentlyIn !== 'mention' || isCurrentMentionResolved)
		) {
			const entry = inputHistory.navigateDown();
			setInputFromHistory(entry);
		}
	});

	return (
		<>
			<MainInput
				inputState={inputState}
				setInputState={setInputState}
				cursorPosition={cursorPosition}
				setCursorPosition={setCursorPosition}
				inputRef={inputRef}
				setInputRef={setInputRef}
				focused={!isAnyWizardOpen && !messages.isStreaming}
				isStreaming={messages.isStreaming}
				cancelState={messages.cancelState}
			/>

			{cursorIsCurrentlyIn === 'mention' &&
			!isCurrentMentionResolved &&
			!isAnyWizardOpen &&
			!messages.isStreaming ? (
				<RepoMentionPalette
					inputState={inputState}
					setInputState={setInputState}
					inputRef={inputRef}
					cursorPosition={cursorPosition}
				/>
			) : null}

			{cursorIsCurrentlyIn === 'command' && !isAnyWizardOpen && !messages.isStreaming ? (
				<CommandPalette
					inputState={inputState}
					setInputState={setInputState}
					inputRef={inputRef}
					onExecute={handleCommandExecute}
				/>
			) : null}

			{activeWizard === 'connect' ? (
				<ConnectWizard onClose={closeWizard} onStepChange={setCurrentWizardStep} />
			) : null}

			{activeWizard === 'add-repo' ? (
				<AddResourceWizard onClose={closeWizard} onStepChange={setCurrentWizardStep} />
			) : null}

			{activeWizard === 'resume' ? (
				<ResumeThreadModal
					maxVisibleItems={maxResumeThreadItems}
					onClose={closeWizard}
					onSelect={async (threadId) => {
						await messages.resumeThread(threadId);
						closeWizard();
					}}
				/>
			) : null}

			<StatusBar
				cursorIn={cursorIsCurrentlyIn}
				isStreaming={messages.isStreaming}
				cancelState={messages.cancelState}
				threadResources={messages.threadResources}
				activeWizard={activeWizard}
				wizardStep={currentWizardStep}
			/>
		</>
	);
};
