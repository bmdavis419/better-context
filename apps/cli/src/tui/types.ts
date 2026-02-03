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

export type CommandMode = 'add-repo' | 'connect' | 'clear' | 'resume';

export type ActiveWizard = 'none' | 'add-repo' | 'connect' | 'resume';

export type WizardStep =
	| 'type'
	| 'name'
	| 'url'
	| 'branch'
	| 'searchPath'
	| 'path'
	| 'notes'
	| 'confirm'
	| 'provider'
	| 'auth'
	| 'api-key'
	| 'model'
	| 'model-input'
	| 'compat-base-url'
	| 'compat-name'
	| 'compat-model'
	| 'compat-api-key'
	| null;

export interface Command {
	name: string;
	description: string;
	mode: CommandMode;
}
