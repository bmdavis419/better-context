import { useKeyboard } from '@opentui/react';
import { useState, useMemo } from 'react';
import { filterCommands, type Command } from './commands.ts';
import { CommandPalette } from './CommandPalette.tsx';
import { AddRepoPrompt } from './AddRepoPrompt.tsx';
import { RepoSelector } from './RepoSelector.tsx';

// Color palette matching apps/web (dark mode)
const colors = {
	// Backgrounds
	bg: '#0a0a0a', // neutral-950
	bgSubtle: '#171717', // neutral-900
	bgMuted: '#262626', // neutral-800

	// Text
	text: '#fafafa', // neutral-50
	textMuted: '#a3a3a3', // neutral-400
	textSubtle: '#737373', // neutral-500

	// Borders
	border: '#262626', // neutral-800
	borderSubtle: '#404040', // neutral-700

	// Accent (orange)
	accent: '#f97316', // orange-500
	accentDark: '#c2410c', // orange-700

	// Semantic
	success: '#22c55e', // green-500
	info: '#3b82f6' // blue-500
};

const MODELS = {
	sonnet: 'anthropic/claude-sonnet-4-20250514',
	opus: 'anthropic/claude-opus-4-20250514',
	haiku: 'anthropic/claude-haiku-3-20240307'
} as const;

type ModelKey = keyof typeof MODELS;
type Mode = 'chat' | 'command-palette' | 'add-repo' | 'select-repo';

interface Message {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

export function App() {
	// Core state
	const [repos, setRepos] = useState(['opentui', 'effect', 'svelte', 'nextjs', 'react', 'clerk']);
	const [selectedRepo, setSelectedRepo] = useState(0);
	const [messages, setMessages] = useState<Message[]>([
		{ role: 'user', content: 'How do I create a TUI with opentui?' },
		{
			role: 'assistant',
			content: 'Use createCliRenderer() to start, then add components to the root.'
		}
	]);

	// Mode and input state
	const [mode, setMode] = useState<Mode>('chat');
	const [inputValue, setInputValue] = useState('');
	const [commandIndex, setCommandIndex] = useState(0);
	const [addRepoValue, setAddRepoValue] = useState('');
	const [repoSelectorIndex, setRepoSelectorIndex] = useState(0);

	// Derived state
	const showCommandPalette = mode === 'chat' && inputValue.startsWith('/');
	const commandQuery = inputValue.slice(1); // Remove the '/'
	const filteredCommands = useMemo(() => filterCommands(commandQuery), [commandQuery]);

	// Reset command index when filtered commands change
	const clampedCommandIndex = Math.min(commandIndex, Math.max(0, filteredCommands.length - 1));

	const handleInputChange = (value: string) => {
		setInputValue(value);
		// Reset command index when input changes
		setCommandIndex(0);
	};

	const executeCommand = (command: Command) => {
		setInputValue('');
		setCommandIndex(0);

		if (command.mode === 'add-repo') {
			setMode('add-repo');
			setAddRepoValue('');
		} else if (command.mode === 'select-repo') {
			setMode('select-repo');
			setRepoSelectorIndex(selectedRepo);
		}
	};

	const handleChatSubmit = () => {
		const value = inputValue.trim();
		if (!value) return;

		// If showing command palette and pressing enter, execute selected command
		if (showCommandPalette && filteredCommands.length > 0) {
			const command = filteredCommands[clampedCommandIndex];
			if (command) {
				executeCommand(command);
				return;
			}
		}

		// Regular message
		setMessages((prev) => [...prev, { role: 'user', content: value }]);
		setInputValue('');
	};

	const handleAddRepo = () => {
		const value = addRepoValue.trim();
		if (!value) return;

		setRepos((prev) => [...prev, value]);
		setMessages((prev) => [...prev, { role: 'system', content: `Added repo: ${value}` }]);
		setAddRepoValue('');
		setMode('chat');
	};

	const handleSelectRepo = () => {
		setSelectedRepo(repoSelectorIndex);
		setMessages([]); // Clear chat when switching repo
		setMode('chat');
	};

	const cancelMode = () => {
		setMode('chat');
		setInputValue('');
		setAddRepoValue('');
	};

	useKeyboard((key) => {
		// Escape always cancels current mode
		if (key.name === 'escape') {
			key.preventDefault();
			if (mode !== 'chat') {
				cancelMode();
			} else if (showCommandPalette) {
				setInputValue('');
			}
			return;
		}

		// Mode-specific keyboard handling
		if (mode === 'chat' && showCommandPalette) {
			// Command palette navigation
			if (key.name === 'up') {
				key.preventDefault();
				setCommandIndex((prev) => (prev === 0 ? filteredCommands.length - 1 : prev - 1));
			} else if (key.name === 'down') {
				key.preventDefault();
				setCommandIndex((prev) => (prev === filteredCommands.length - 1 ? 0 : prev + 1));
			}
		} else if (mode === 'select-repo') {
			// Repo selector navigation
			if (key.name === 'up') {
				key.preventDefault();
				setRepoSelectorIndex((prev) => (prev === 0 ? repos.length - 1 : prev - 1));
			} else if (key.name === 'down') {
				key.preventDefault();
				setRepoSelectorIndex((prev) => (prev === repos.length - 1 ? 0 : prev + 1));
			}
		}

		if (key.name === 'return' && mode === 'select-repo') {
			key.preventDefault();
			handleSelectRepo();
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
					<span fg={colors.textMuted}>{' - Better Context AI'}</span>
				</text>
				<text fg={colors.textSubtle} content="v0.3.3" />
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
					{repos.map((repo, i) => (
						<text
							key={repo}
							fg={i === selectedRepo ? colors.accent : colors.textSubtle}
							content={i === selectedRepo ? `▸ ${repo}` : `  ${repo}`}
						/>
					))}
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
				</box>
			</box>

			{/* Overlays - positioned relative to the input area */}
			{showCommandPalette && (
				<CommandPalette
					commands={filteredCommands}
					selectedIndex={clampedCommandIndex}
					colors={colors}
				/>
			)}

			{mode === 'add-repo' && (
				<AddRepoPrompt
					value={addRepoValue}
					onInput={setAddRepoValue}
					onSubmit={handleAddRepo}
					colors={colors}
				/>
			)}

			{mode === 'select-repo' && (
				<RepoSelector
					repos={repos}
					selectedIndex={repoSelectorIndex}
					currentRepo={selectedRepo}
					colors={colors}
				/>
			)}

			{/* Input area */}
			<box
				style={{
					border: true,
					borderColor: colors.accent,
					height: 3,
					width: '100%',
					paddingLeft: 1,
					paddingRight: 1
				}}
			>
				<input
					placeholder="Message or / for commands..."
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
						showCommandPalette
							? ' [↑↓] Navigate  [Enter] Select  [Esc] Cancel'
							: mode === 'add-repo'
								? ' [Enter] Add repo  [Esc] Cancel'
								: mode === 'select-repo'
									? ' [↑↓] Navigate  [Enter] Select  [Esc] Cancel'
									: ' [/] Commands  [Enter] Send  [Ctrl+C] Quit'
					}
				/>
			</box>
		</box>
	);
}
