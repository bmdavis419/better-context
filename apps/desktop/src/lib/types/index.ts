import { z } from 'zod';

// Re-export shared types
export type {
	TextChunk,
	ReasoningChunk,
	ToolChunk,
	FileChunk,
	BtcaChunk,
	AssistantContent,
	ThreadMessage,
	CancelState
} from '@btca/shared';

export { formatConversationHistory, extractMessageText } from '@btca/shared';

import type { BtcaChunk, AssistantContent } from '@btca/shared';

// Resource types
export interface Resource {
	name: string;
	type: 'git' | 'local' | 'npm';
	url?: string;
	branch?: string;
	path?: string;
	package?: string;
	version?: string;
	searchPath?: string;
	specialNotes?: string;
}

export interface MessageStats {
	durationMs?: number;
	inputTokens?: number;
	outputTokens?: number;
	cachedTokens?: number;
	totalTokens?: number;
	tokensPerSecond?: number;
	totalPriceUsd?: number;
}

// Message types (using AssistantContent from shared)
export type Message =
	| {
			id: string;
			role: 'user';
			content: string;
			resources: string[];
	  }
	| {
			id: string;
			role: 'assistant';
			content: AssistantContent;
			canceled?: boolean;
			stats?: MessageStats;
	  }
	| {
			id: string;
			role: 'system';
			content: string;
	  };

// Session types
export interface ChatSession {
	id: string;
	sandboxId: string;
	serverUrl: string;
	messages: Message[];
	threadResources: string[];
	createdAt: Date;
	lastActivityAt: Date;
	status: 'pending' | 'creating' | 'cloning' | 'starting' | 'active' | 'error' | 'destroyed';
	error?: string;
}

// Stream event types (from btca server - matching apps/server/src/stream/types.ts)
const BtcaModelSchema = z.object({
	provider: z.string(),
	model: z.string()
});

const BtcaCollectionInfoSchema = z.object({
	key: z.string(),
	path: z.string()
});

const BtcaToolStateSchema = z.object({
	status: z.enum(['pending', 'running', 'completed', 'error']),
	input: z.record(z.string(), z.unknown()).optional(),
	output: z.string().optional(),
	title: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	error: z.string().optional(),
	raw: z.string().optional(),
	time: z
		.object({
			start: z.number(),
			end: z.number().optional(),
			compacted: z.number().optional()
		})
		.optional()
});

export const BtcaStreamEventSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('meta'),
		model: BtcaModelSchema,
		resources: z.array(z.string()),
		collection: BtcaCollectionInfoSchema
	}),
	z.object({
		type: z.literal('text.delta'),
		delta: z.string()
	}),
	z.object({
		type: z.literal('reasoning.delta'),
		delta: z.string()
	}),
	z.object({
		type: z.literal('tool.updated'),
		callID: z.string(),
		tool: z.string(),
		state: BtcaToolStateSchema
	}),
	z.object({
		type: z.literal('done'),
		text: z.string(),
		reasoning: z.string(),
		tools: z.array(
			z.object({
				callID: z.string(),
				tool: z.string(),
				state: BtcaToolStateSchema
			})
		),
		usage: z
			.object({
				inputTokens: z.number().optional(),
				outputTokens: z.number().optional(),
				reasoningTokens: z.number().optional(),
				totalTokens: z.number().optional()
			})
			.optional(),
		metrics: z
			.object({
				timing: z
					.object({
						totalMs: z.number().optional(),
						genMs: z.number().optional()
					})
					.optional(),
				throughput: z
					.object({
						outputTokensPerSecond: z.number().optional(),
						totalTokensPerSecond: z.number().optional()
					})
					.optional(),
				pricing: z
					.object({
						source: z.literal('models.dev'),
						modelKey: z.string().optional(),
						ratesUsdPerMTokens: z
							.object({
								input: z.number().optional(),
								output: z.number().optional(),
								reasoning: z.number().optional(),
								cacheRead: z.number().optional(),
								cacheWrite: z.number().optional()
							})
							.optional(),
						costUsd: z
							.object({
								input: z.number().optional(),
								output: z.number().optional(),
								reasoning: z.number().optional(),
								total: z.number().optional()
							})
							.optional()
					})
					.optional()
			})
			.optional()
	}),
	z.object({
		type: z.literal('error'),
		tag: z.string(),
		message: z.string()
	})
]);

export type BtcaStreamEvent = z.infer<typeof BtcaStreamEventSchema>;

// Command palette types
export type CommandMode = 'add-resource' | 'switch-session' | 'clear' | 'destroy-sandbox';

export interface Command {
	name: string;
	description: string;
	mode: CommandMode;
	shortcut?: string;
}

export const COMMANDS: Command[] = [
	{
		name: 'Clear Chat',
		description: 'Clear the current chat messages',
		mode: 'clear',
		shortcut: 'Ctrl+L'
	},
	{
		name: 'Switch Session',
		description: 'Switch to a different chat session',
		mode: 'switch-session',
		shortcut: 'Ctrl+K'
	},
	{
		name: 'Destroy Sandbox',
		description: 'Destroy the current sandbox and end the session',
		mode: 'destroy-sandbox'
	}
];

// CancelState is re-exported from @btca/shared above
