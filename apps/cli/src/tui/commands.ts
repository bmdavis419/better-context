import type { Command } from './types.ts';

export const COMMANDS: Command[] = [
	{
		name: 'add',
		description: 'Add a new repo (wizard)',
		mode: 'add-repo'
	},
	{
		name: 'remove',
		description: 'Remove a repo from config',
		mode: 'remove-repo'
	},
	{
		name: 'model',
		description: 'Configure model & provider',
		mode: 'config-model'
	},
	{
		name: 'chat',
		description: 'Start chat session (opens OpenCode)',
		mode: 'chat'
	},
	{
		name: 'ask',
		description: 'Ask question, copy answer to clipboard',
		mode: 'ask'
	},
	{
		name: 'clear',
		description: 'Clear chat history',
		mode: 'clear'
	}
];

export function filterCommands(query: string): Command[] {
	const lowerQuery = query.toLowerCase();
	return COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(lowerQuery));
}
