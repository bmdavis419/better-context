export interface Repo {
	name: string;
	url: string;
	branch: string;
	specialNotes?: string;
}

export interface Message {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

export type Mode =
	| 'chat'
	| 'add-repo'
	| 'select-repo'
	| 'remove-repo'
	| 'config-model'
	| 'loading';

export type CommandMode = 'add-repo' | 'select-repo' | 'remove-repo' | 'config-model' | 'chat' | 'ask' | 'clear';

export interface Command {
	name: string;
	description: string;
	mode: CommandMode;
}
