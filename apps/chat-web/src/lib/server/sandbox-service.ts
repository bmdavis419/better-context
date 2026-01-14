import { Daytona, type Sandbox } from '@daytonaio/sdk';
import { env } from '$env/dynamic/private';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// Daytona instance (singleton)
let daytonaInstance: Daytona | null = null;

// Snapshot name for btca sandbox
const BTCA_SNAPSHOT_NAME = 'btca-sandbox';

// Auto-stop interval in minutes (sandbox stops after this period of inactivity)
const AUTO_STOP_INTERVAL = 5;

// Server port for btca serve
const BTCA_SERVER_PORT = 3000;

export interface ResourceConfig {
	name: string;
	type: 'git';
	url: string;
	branch: string;
	searchPath?: string;
	specialNotes?: string;
}

// Status updates sent to client during sandbox operations
export type SandboxStatus = 'creating' | 'starting' | 'ready' | 'error';

function getDaytona(): Daytona {
	if (!daytonaInstance) {
		daytonaInstance = new Daytona({
			apiKey: env.DAYTONA_API_KEY,
			apiUrl: env.DAYTONA_API_URL
		});
	}
	return daytonaInstance;
}

function getConvexClient(): ConvexHttpClient {
	return new ConvexHttpClient(PUBLIC_CONVEX_URL);
}

/**
 * Generate btca config from resources
 */
function generateBtcaConfig(resources: ResourceConfig[]): string {
	return JSON.stringify(
		{
			$schema: 'https://btca.dev/btca.schema.json',
			resources: resources.map((r) => ({
				name: r.name,
				type: r.type,
				url: r.url,
				branch: r.branch,
				searchPath: r.searchPath,
				specialNotes: r.specialNotes
			})),
			model: 'claude-haiku-4-5',
			provider: 'opencode'
		},
		null,
		2
	);
}

/**
 * Wait for btca server to be ready in the sandbox
 */
async function waitForBtcaServer(sandbox: Sandbox, maxRetries = 15): Promise<boolean> {
	for (let i = 0; i < maxRetries; i++) {
		await new Promise((resolve) => setTimeout(resolve, 2000));

		try {
			const healthCheck = await sandbox.process.executeCommand(
				`curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:${BTCA_SERVER_PORT}/`
			);

			const statusCode = healthCheck.result.trim();
			if (statusCode === '200') {
				return true;
			}
		} catch {
			// Continue retrying
		}
	}
	return false;
}

/**
 * Get sandbox state and server URL from Daytona
 */
async function getSandboxInfo(
	sandboxId: string
): Promise<{ state: 'started' | 'stopped' | 'unknown'; serverUrl: string | null }> {
	const daytona = getDaytona();

	try {
		const sandbox = await daytona.get(sandboxId);
		const state = sandbox.state;

		if (state === 'started') {
			const previewInfo = await sandbox.getPreviewLink(BTCA_SERVER_PORT);
			return { state: 'started', serverUrl: previewInfo.url };
		} else if (state === 'stopped') {
			return { state: 'stopped', serverUrl: null };
		}
		return { state: 'unknown', serverUrl: null };
	} catch {
		return { state: 'unknown', serverUrl: null };
	}
}

/**
 * Create a new sandbox
 */
async function createSandbox(
	resources: ResourceConfig[],
	onStatus?: (status: SandboxStatus) => void
): Promise<{ sandboxId: string; serverUrl: string }> {
	const daytona = getDaytona();

	onStatus?.('creating');

	// Create sandbox from pre-built snapshot
	const sandbox = await daytona.create({
		snapshot: BTCA_SNAPSHOT_NAME,
		autoStopInterval: AUTO_STOP_INTERVAL,
		envVars: {
			NODE_ENV: 'production',
			OPENCODE_API_KEY: env.OPENCODE_API_KEY ?? ''
		},
		public: true
	});

	// Generate and upload btca config
	const btcaConfig = generateBtcaConfig(resources);
	await sandbox.fs.uploadFile(Buffer.from(btcaConfig), '/root/btca.config.jsonc');

	// Create a session for the long-running server process
	const sandboxSessionId = 'btca-server-session';
	await sandbox.process.createSession(sandboxSessionId);

	// Start the btca serve command
	await sandbox.process.executeSessionCommand(sandboxSessionId, {
		command: `cd /root && btca serve --port ${BTCA_SERVER_PORT}`,
		runAsync: true
	});

	// Wait for server to be ready
	const serverReady = await waitForBtcaServer(sandbox);

	if (!serverReady) {
		// Clean up and throw
		try {
			await sandbox.delete();
		} catch {
			// Ignore cleanup errors
		}
		throw new Error('Server failed to start in time');
	}

	// Get the preview link for the server
	const previewInfo = await sandbox.getPreviewLink(BTCA_SERVER_PORT);

	onStatus?.('ready');

	return {
		sandboxId: sandbox.id,
		serverUrl: previewInfo.url
	};
}

/**
 * Start a stopped sandbox
 */
async function startSandbox(
	sandboxId: string,
	onStatus?: (status: SandboxStatus) => void
): Promise<string> {
	const daytona = getDaytona();

	onStatus?.('starting');

	const sandbox = await daytona.get(sandboxId);
	await sandbox.start(60); // 60 second timeout

	// Re-start the btca server (it won't be running after stop)
	const sandboxSessionId = 'btca-server-session';
	try {
		await sandbox.process.createSession(sandboxSessionId);
	} catch {
		// Session may already exist
	}

	await sandbox.process.executeSessionCommand(sandboxSessionId, {
		command: `cd /root && btca serve --port ${BTCA_SERVER_PORT}`,
		runAsync: true
	});

	// Wait for server to be ready
	const serverReady = await waitForBtcaServer(sandbox);

	if (!serverReady) {
		throw new Error('Server failed to start after resume');
	}

	// Get the preview link
	const previewInfo = await sandbox.getPreviewLink(BTCA_SERVER_PORT);

	onStatus?.('ready');

	return previewInfo.url;
}

/**
 * Stop a sandbox (free CPU/memory but keep disk)
 */
async function stopSandbox(sandboxId: string): Promise<void> {
	const daytona = getDaytona();

	try {
		const info = await getSandboxInfo(sandboxId);
		if (info.state === 'started') {
			const sandbox = await daytona.get(sandboxId);
			await sandbox.stop();
		}
	} catch (error) {
		console.error('Error stopping sandbox:', error);
		// Don't throw - stopping is best effort
	}
}

/**
 * Delete a sandbox completely
 */
async function deleteSandbox(sandboxId: string): Promise<void> {
	const daytona = getDaytona();

	try {
		const sandbox = await daytona.get(sandboxId);
		await sandbox.delete();
	} catch (error) {
		console.error('Error deleting sandbox:', error);
		// Don't throw - deletion is best effort
	}
}

/**
 * Stop all other sandboxes for a user (enforce 1 active sandbox rule)
 */
export async function stopOtherSandboxes(
	userId: Id<'users'>,
	currentThreadId: Id<'threads'>
): Promise<void> {
	const convex = getConvexClient();

	try {
		const threads = await convex.query(api.threads.listWithSandbox, { userId });

		for (const thread of threads) {
			if (thread._id !== currentThreadId && thread.sandboxId) {
				await stopSandbox(thread.sandboxId);
			}
		}
	} catch (error) {
		console.error('Error stopping other sandboxes:', error);
		// Don't throw - this is best effort
	}
}

/**
 * Ensure a sandbox is ready for a thread.
 * - If thread has no sandbox, create one
 * - If sandbox exists but is stopped, start it
 * - If sandbox exists and is running, return its URL
 *
 * Returns the server URL to use for requests.
 */
export async function ensureSandboxReady(
	threadId: Id<'threads'>,
	sandboxId: string | undefined,
	resources: ResourceConfig[],
	onStatus?: (status: SandboxStatus) => void
): Promise<string> {
	const convex = getConvexClient();

	// No sandbox exists - create one
	if (!sandboxId) {
		const result = await createSandbox(resources, onStatus);

		// Save sandbox ID to thread
		await convex.mutation(api.threads.setSandboxId, {
			threadId,
			sandboxId: result.sandboxId
		});

		return result.serverUrl;
	}

	// Sandbox exists - check its state from Daytona
	const info = await getSandboxInfo(sandboxId);

	if (info.state === 'started' && info.serverUrl) {
		onStatus?.('ready');
		return info.serverUrl;
	}

	if (info.state === 'stopped') {
		// Start the stopped sandbox
		return await startSandbox(sandboxId, onStatus);
	}

	// Unknown state - sandbox may have been deleted, create a new one
	const result = await createSandbox(resources, onStatus);

	// Update sandbox ID in thread
	await convex.mutation(api.threads.setSandboxId, {
		threadId,
		sandboxId: result.sandboxId
	});

	return result.serverUrl;
}
