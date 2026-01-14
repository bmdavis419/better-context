import { Daytona, type Sandbox } from '@daytonaio/sdk';
import { nanoid } from 'nanoid';
import type { ChatSession, Message } from '../types/index.ts';
import { env } from '$env/dynamic/private';

// In-memory session storage
const sessions = new Map<string, ChatSession>();
const sandboxes = new Map<string, Sandbox>();

// Daytona instance (singleton)
let daytonaInstance: Daytona | null = null;

// Snapshot name for btca sandbox
const BTCA_SNAPSHOT_NAME = 'btca-sandbox';

// Default btca config to inject into the sandbox
const DEFAULT_BTCA_CONFIG = `{
  "$schema": "https://btca.dev/btca.schema.json",
  "resources": [
    {
      "name": "svelte",
      "type": "git",
      "url": "https://github.com/sveltejs/svelte.dev",
      "branch": "main",
      "searchPath": "apps/svelte.dev",
      "specialNotes": "Svelte docs website. Focus on content directory for markdown documentation."
    },
    {
      "name": "svelteKit",
      "type": "git",
      "url": "https://github.com/sveltejs/kit",
      "branch": "main",
      "searchPath": "documentation",
      "specialNotes": "SvelteKit docs. Focus on documentation directory."
    },
    {
      "name": "tailwind",
      "type": "git",
      "url": "https://github.com/tailwindlabs/tailwindcss.com",
      "branch": "main",
      "searchPath": "src/docs",
      "specialNotes": "Tailwind CSS documentation."
    }
  ],
  "model": "claude-haiku-4-5",
  "provider": "opencode"
}`;

// Server port for btca serve
const BTCA_SERVER_PORT = 3000;

// Default resources parsed from config
const DEFAULT_RESOURCES = [
	{ name: 'svelte', type: 'git' },
	{ name: 'svelteKit', type: 'git' },
	{ name: 'tailwind', type: 'git' }
];

function getDaytona(): Daytona {
	if (!daytonaInstance) {
		daytonaInstance = new Daytona({
			apiKey: env.DAYTONA_API_KEY,
			apiUrl: env.DAYTONA_API_URL
		});
	}
	return daytonaInstance;
}

/**
 * Create a new chat session (lazy - no sandbox yet)
 */
export function createSession(): ChatSession {
	const sessionId = nanoid();

	const session: ChatSession = {
		id: sessionId,
		sandboxId: '',
		serverUrl: '',
		messages: [
			{
				id: nanoid(),
				role: 'system',
				content:
					"Welcome to btca Chat! Ask anything about the library/framework you're interested in (make sure you @mention it first, e.g. @svelte)"
			}
		],
		threadResources: [],
		createdAt: new Date(),
		lastActivityAt: new Date(),
		status: 'pending'
	};

	sessions.set(sessionId, session);
	return session;
}

/**
 * Initialize sandbox for a session (called on first message)
 * Emits status updates via callback
 */
export async function initializeSandbox(
	sessionId: string,
	onStatusChange?: (status: ChatSession['status']) => void
): Promise<ChatSession> {
	const session = sessions.get(sessionId);
	if (!session) {
		throw new Error('Session not found');
	}

	if (session.status === 'active') {
		return session;
	}

	if (session.status !== 'pending') {
		throw new Error(`Cannot initialize sandbox: session status is ${session.status}`);
	}

	const daytona = getDaytona();

	try {
		// Update status: creating sandbox
		session.status = 'creating';
		sessions.set(sessionId, session);
		onStatusChange?.('creating');

		// Create sandbox from pre-built snapshot
		const sandbox = await daytona.create({
			snapshot: BTCA_SNAPSHOT_NAME,
			envVars: {
				NODE_ENV: 'production',
				OPENCODE_API_KEY: env.OPENCODE_API_KEY
			},
			public: true
		});

		session.sandboxId = sandbox.id;
		sandboxes.set(sandbox.id, sandbox);

		// Update status: cloning/configuring
		session.status = 'cloning';
		sessions.set(sessionId, session);
		onStatusChange?.('cloning');

		// Create btca config
		await sandbox.fs.uploadFile(Buffer.from(DEFAULT_BTCA_CONFIG), '/root/btca.config.jsonc');

		// Update status: starting server
		session.status = 'starting';
		sessions.set(sessionId, session);
		onStatusChange?.('starting');

		// Create a session for the long-running server process
		const sandboxSessionId = 'btca-server-session';
		await sandbox.process.createSession(sandboxSessionId);

		// Start the btca serve command
		await sandbox.process.executeSessionCommand(sandboxSessionId, {
			command: `cd /root && btca serve --port ${BTCA_SERVER_PORT}`,
			runAsync: true
		});

		// Wait for server to be ready
		const maxRetries = 15;
		let serverReady = false;

		for (let i = 0; i < maxRetries; i++) {
			await new Promise((resolve) => setTimeout(resolve, 2000));

			const healthCheck = await sandbox.process.executeCommand(
				`curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:${BTCA_SERVER_PORT}/`
			);

			const statusCode = healthCheck.result.trim();
			if (statusCode === '200') {
				serverReady = true;
				break;
			}
		}

		if (!serverReady) {
			throw new Error('Server failed to start in time');
		}

		// Get the preview link for the server
		const previewInfo = await sandbox.getPreviewLink(BTCA_SERVER_PORT);
		session.serverUrl = previewInfo.url;
		session.status = 'active';
		sessions.set(sessionId, session);
		onStatusChange?.('active');

		return session;
	} catch (error) {
		// Clean up sandbox if it was created
		if (session.sandboxId) {
			const sandbox = sandboxes.get(session.sandboxId);
			if (sandbox) {
				try {
					await sandbox.delete();
				} catch (cleanupError) {
					console.error('Failed to clean up sandbox:', cleanupError);
				}
				sandboxes.delete(session.sandboxId);
			}
		}

		session.status = 'error';
		session.error = error instanceof Error ? error.message : 'Unknown error creating sandbox';
		sessions.set(sessionId, session);
		onStatusChange?.('error');
		throw error;
	}
}

/**
 * Get a session by ID
 */
export function getSession(sessionId: string): ChatSession | undefined {
	return sessions.get(sessionId);
}

/**
 * Get all sessions
 */
export function getAllSessions(): ChatSession[] {
	return Array.from(sessions.values()).sort(
		(a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime()
	);
}

/**
 * Update session messages
 */
export function updateSessionMessages(sessionId: string, messages: Message[]): void {
	const session = sessions.get(sessionId);
	if (session) {
		session.messages = messages;
		session.lastActivityAt = new Date();
		sessions.set(sessionId, session);
	}
}

/**
 * Update session thread resources
 */
export function updateSessionResources(sessionId: string, resources: string[]): void {
	const session = sessions.get(sessionId);
	if (session) {
		session.threadResources = resources;
		session.lastActivityAt = new Date();
		sessions.set(sessionId, session);
	}
}

/**
 * Destroy a session and its sandbox
 */
export async function destroySession(sessionId: string): Promise<void> {
	const session = sessions.get(sessionId);
	if (!session) return;

	const sandbox = sandboxes.get(session.sandboxId);
	if (sandbox) {
		try {
			await sandbox.delete();
		} catch (error) {
			console.error('Error deleting sandbox:', error);
		}
		sandboxes.delete(session.sandboxId);
	}

	session.status = 'destroyed';
	sessions.delete(sessionId);
}

/**
 * Clear session messages (but keep the session)
 */
export function clearSession(sessionId: string): void {
	const session = sessions.get(sessionId);
	if (session) {
		session.messages = [
			{
				id: nanoid(),
				role: 'system',
				content: 'Chat cleared. Start a new conversation!'
			}
		];
		session.threadResources = [];
		session.lastActivityAt = new Date();
		sessions.set(sessionId, session);
	}
}

/**
 * Get default resources (used for pending sessions)
 */
export function getDefaultResources(): { name: string; type: string }[] {
	return DEFAULT_RESOURCES;
}

/**
 * Get resources from a session's btca server
 */
export async function getSessionResources(
	sessionId: string
): Promise<{ name: string; type: string }[]> {
	const session = sessions.get(sessionId);
	if (!session || session.status !== 'active') {
		return DEFAULT_RESOURCES;
	}

	try {
		const response = await fetch(`${session.serverUrl}/resources`);
		if (!response.ok) {
			throw new Error(`Failed to get resources: ${response.status}`);
		}
		const data = (await response.json()) as { resources: { name: string; type: string }[] };
		return data.resources;
	} catch (error) {
		console.error('Error fetching resources:', error);
		return DEFAULT_RESOURCES;
	}
}
