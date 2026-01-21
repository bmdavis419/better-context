import type { Command } from './types.ts';

export const COMMANDS: Command[] = [
	{
		name: 'connect',
		description: 'Connect a model provider',
		mode: 'connect-provider'
	},
	{
		name: 'model',
		description: 'Select from recommended models',
		mode: 'select-blessed-model'
	},
	{
		name: 'add',
		description: 'Add a new resource',
		mode: 'add-repo'
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
