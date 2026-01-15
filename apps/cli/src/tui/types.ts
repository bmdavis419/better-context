// Re-export shared types
export type {
	TextChunk,
	ReasoningChunk,
	ToolChunk,
	FileChunk,
	BtcaChunk,
	CancelState,
	AssistantContent
} from '@btca/shared';

import type { AssistantContent } from '@btca/shared';

export interface Repo {
	name: string;
	url: string;
	branch: string;
	specialNotes?: string | undefined;
	searchPath?: string | undefined;
	searchPaths?: string[] | undefined;
	cloneStrategy?: 'git' | 'gitpick' | undefined;
}

export type InputState = (
	| {
			type: 'text' | 'command' | 'mention';
			content: string;
	  }
	| {
			type: 'pasted';
			content: string;
			lines: number;
	  }
)[];

export type Message =
	| {
			role: 'user';
			content: InputState;
	  }
	| {
			role: 'assistant';
			content: AssistantContent;
			canceled?: boolean; // true if this response was canceled
	  }
	| {
			role: 'system';
			content: string;
	  };

export type CommandMode = 'add-repo' | 'select-blessed-model' | 'clear';

export type ActiveWizard = 'none' | 'add-repo' | 'blessed-model';

export type WizardStep =
	| 'type'
	| 'name'
	| 'url'
	| 'branch'
	| 'searchPath'
	| 'path'
	| 'notes'
	| 'confirm'
	| null;

export interface Command {
	name: string;
	description: string;
	mode: CommandMode;
}
