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

export { type OcEvent };
