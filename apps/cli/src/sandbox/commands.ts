export interface Command {
	name: string;
	description: string;
	mode: 'add-repo' | 'select-repo';
}

export const COMMANDS: Command[] = [
	{
		name: 'add',
		description: 'Add a new repo',
		mode: 'add-repo'
	},
	{
		name: 'repo',
		description: 'Switch to a different repo',
		mode: 'select-repo'
	}
];

export function filterCommands(query: string): Command[] {
	const normalizedQuery = query.toLowerCase();
	return COMMANDS.filter((cmd) => cmd.name.toLowerCase().startsWith(normalizedQuery));
}
