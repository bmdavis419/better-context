import type { BtcaChunk } from '../core/index.ts';

export interface Repo {
	name: string;
	url: string;
	branch: string;
	specialNotes?: string | undefined;
	searchPath?: string | undefined;
}

// Thread types for TUI state
export type QuestionStatus = 'completed' | 'canceled';

export interface ThreadQuestion {
	id: string;
	prompt: string;
	answer: string;
	resources: string[]; // resources added by THIS question only
	status: QuestionStatus;
}

export interface ThreadState {
	id: string;
	resources: string[]; // accumulated resources across all questions
	questions: ThreadQuestion[];
}

export type CancelState = 'none' | 'pending';

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

export type AssistantContent =
	| { type: 'text'; content: string }
	| { type: 'chunks'; chunks: BtcaChunk[] };

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

export type CommandMode =
	| 'add-repo'
	| 'remove-repo'
	| 'config-model'
	| 'select-blessed-model'
	| 'chat'
	| 'ask'
	| 'clear';

export interface Command {
	name: string;
	description: string;
	mode: CommandMode;
}
