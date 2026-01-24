import type { Event as OcEvent, OpencodeClient } from '@opencode-ai/sdk';

export type AgentResult = {
	answer: string;
	model: { provider: string; model: string };
	events: OcEvent[];
};

export type SessionState = {
	client: OpencodeClient;
	server: { close: () => void; url: string };
	sessionID: string;
	collectionPath: string;
};

/**
 * Tracked OpenCode instance for lifecycle management.
 * Used to clean up orphaned instances when callers exit.
 */
export type TrackedInstance = {
	id: string;
	server: { close(): void; url: string };
	createdAt: Date;
	lastActivity: Date;
	collectionPath: string;
};

export type InstanceInfo = {
	id: string;
	createdAt: Date;
	lastActivity: Date;
	collectionPath: string;
	url: string;
};

export { type OcEvent };
