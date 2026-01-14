import { Daytona } from '@daytonaio/sdk';
import type { Sandbox } from '@daytonaio/sdk';
import { BTCA_SNAPSHOT_NAME } from './shared.ts';

// Default btca config to inject into the sandbox
const DEFAULT_BTCA_CONFIG = `{
  "$schema": "https://btca.dev/btca.schema.json",
  "resources": [
    {
      "name": "daytona",
      "type": "git",
      "url": "https://github.com/daytonaio/daytona",
      "branch": "main",
      "specialNotes": "this is the full daytona codebase. focus on the guides and examples for answers"
    },
    {
      "name": "svelte",
      "type": "git",
      "url": "https://github.com/sveltejs/svelte.dev",
      "branch": "main",
      "searchPath": "apps/svelte.dev",
      "specialNotes": "Svelte docs website. Focus on content directory for markdown documentation."
    }
  ],
  "model": "claude-haiku-4-5",
  "provider": "opencode"
}`;

// Server port for btca serve
const BTCA_SERVER_PORT = 3000;

// Required environment variables
const REQUIRED_ENV_VARS = ['DAYTONA_API_KEY', 'OPENCODE_API_KEY'] as const;

function validateEnvVars(): void {
	const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
	if (missing.length > 0) {
		console.error('Missing required environment variables:');
		missing.forEach((v) => console.error(`  - ${v}`));
		console.error('\nRequired environment variables:');
		console.error('  DAYTONA_API_KEY    - Daytona API key for sandbox creation');
		console.error('  OPENCODE_API_KEY   - OpenCode API key for zen provider authentication');
		console.error('\nOptional environment variables:');
		console.error('  DAYTONA_API_URL    - Daytona API URL (default: https://app.daytona.io/api)');
		process.exit(1);
	}
}

let sandbox: Sandbox | null = null;
let daytona: Daytona | null = null;

async function cleanup(): Promise<void> {
	if (sandbox && daytona) {
		console.log('\nCleaning up sandbox...');
		try {
			await sandbox.delete();
			console.log('Sandbox deleted successfully.');
		} catch (error) {
			console.error('Error deleting sandbox:', error);
		}
	}
	sandbox = null;
	daytona = null;
}

function setupCleanupHandlers(): void {
	// Handle SIGINT (Ctrl+C)
	process.on('SIGINT', async () => {
		console.log('\nReceived SIGINT...');
		await cleanup();
		process.exit(0);
	});

	// Handle SIGTERM
	process.on('SIGTERM', async () => {
		console.log('\nReceived SIGTERM...');
		await cleanup();
		process.exit(0);
	});

	// Handle uncaught exceptions
	process.on('uncaughtException', async (error) => {
		console.error('Uncaught exception:', error);
		await cleanup();
		process.exit(1);
	});

	// Handle unhandled rejections
	process.on('unhandledRejection', async (reason) => {
		console.error('Unhandled rejection:', reason);
		await cleanup();
		process.exit(1);
	});
}

async function main(): Promise<void> {
	setupCleanupHandlers();
	validateEnvVars();

	console.log('Initializing Daytona SDK...');

	// Initialize Daytona (uses DAYTONA_API_KEY and DAYTONA_API_URL env vars)
	daytona = new Daytona();

	console.log(`Creating sandbox from snapshot: ${BTCA_SNAPSHOT_NAME}`);

	// Create sandbox from pre-built snapshot for fast startup
	sandbox = await daytona.create({
		snapshot: BTCA_SNAPSHOT_NAME,
		envVars: {
			NODE_ENV: 'production',
			OPENCODE_API_KEY: process.env.OPENCODE_API_KEY!
		},
		public: true // Allow public access to preview URLs
	});

	console.log(`Sandbox created with ID: ${sandbox.id}`);

	// Verify bun is available
	const bunVersionResult = await sandbox.process.executeCommand('bun --version');
	console.log(`bun version: ${bunVersionResult.result.trim()}`);

	// Verify btca is available
	const btcaVersionResult = await sandbox.process.executeCommand('btca --version');
	console.log(`btca version: ${btcaVersionResult.result.trim()}`);

	// Create default btca config
	console.log('Setting up btca configuration...');

	await sandbox.fs.uploadFile(Buffer.from(DEFAULT_BTCA_CONFIG), '/root/btca.config.jsonc');
	console.log('Configuration file created at /root/btca.config.jsonc');

	// Verify config was written
	const catResult = await sandbox.process.executeCommand('cat /root/btca.config.jsonc');
	console.log('Config contents:', catResult.result.substring(0, 100) + '...');

	// Start btca serve
	console.log('Starting btca server...');

	// Create a session for the long-running server process
	const sessionId = 'btca-server-session';
	await sandbox.process.createSession(sessionId);

	// Start the btca serve command in the background
	const serverCmd = await sandbox.process.executeSessionCommand(sessionId, {
		command: `cd /root && btca serve --port ${BTCA_SERVER_PORT}`,
		runAsync: true
	});
	console.log(`Server command started with ID: ${serverCmd.cmdId}`);

	// Wait for the server to start and check health
	console.log('Waiting for server to start...');
	const maxRetries = 10;
	let serverReady = false;

	for (let i = 0; i < maxRetries; i++) {
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// Try to hit the health endpoint
		const healthCheck = await sandbox.process.executeCommand(
			`curl -s -o /dev/null -w "%{http_code}" http://localhost:${BTCA_SERVER_PORT}/`
		);

		const statusCode = healthCheck.result.trim();
		console.log(`Health check attempt ${i + 1}/${maxRetries}: HTTP ${statusCode}`);

		if (statusCode === '200') {
			serverReady = true;
			break;
		}
	}

	if (!serverReady) {
		console.error('Server failed to start. Checking logs...');

		// Try to get any error output
		const psResult = await sandbox.process.executeCommand('ps aux | grep btca');
		console.log('Process list:', psResult.result);

		const logsResult = await sandbox.process.executeCommand(
			`curl -s http://localhost:${BTCA_SERVER_PORT}/ 2>&1 || echo "curl failed"`
		);
		console.log('Server response:', logsResult.result);

		await cleanup();
		process.exit(1);
	}

	console.log('Server is healthy!');

	// Get the preview link for the server
	const previewInfo = await sandbox.getPreviewLink(BTCA_SERVER_PORT);

	console.log('\n========================================');
	console.log('BTCA Sandbox is running!');
	console.log('========================================');
	console.log(`Sandbox ID: ${sandbox.id}`);
	console.log(`Server URL: ${previewInfo.url}`);
	console.log('(Public - no auth token required)');
	console.log('========================================');
	console.log('\nPress Ctrl+C to stop the sandbox and clean up.\n');

	// Keep the process running with an interval to prevent exit
	setInterval(() => {}, 1 << 30); // ~12 days, effectively forever
}

main().catch(async (error) => {
	console.error('Error:', error);
	await cleanup();
	process.exit(1);
});
