import { existsSync } from 'node:fs';
import path from 'node:path';
import { ensureServer, type ServerManager } from '../server/manager.ts';
import { createClient, getConfig } from '../client/index.ts';
import { setTelemetryContext, trackTelemetryEvent } from '../lib/telemetry.ts';

// Store server reference globally so TUI can access it
declare global {
	// eslint-disable-next-line no-var
	var __BTCA_SERVER__: ServerManager | undefined;
	// eslint-disable-next-line no-var
	var __BTCA_STREAM_OPTIONS__:
		| {
				showThinking: boolean;
				showTools: boolean;
		  }
		| undefined;
}

export interface TuiOptions {
	server?: string;
	port?: number;
	thinking?: boolean;
	tools?: boolean;
	subAgent?: boolean;
}

let hasWarnedMissingTreeSitterWorker = false;

const resolveStandaloneTreeSitterWorkerPath = () => {
	const executableDir = path.dirname(process.execPath);
	const candidates = [
		path.join(executableDir, 'tree-sitter-worker.js'),
		path.join(executableDir, 'dist', 'tree-sitter-worker.js')
	];
	return candidates.find((candidate) => existsSync(candidate));
};

const ensureStandaloneTreeSitterWorkerPath = () => {
	if (process.env.OTUI_TREE_SITTER_WORKER_PATH) return;

	const workerPath = resolveStandaloneTreeSitterWorkerPath();
	if (workerPath) {
		process.env.OTUI_TREE_SITTER_WORKER_PATH = workerPath;
		return;
	}

	if (hasWarnedMissingTreeSitterWorker) return;
	hasWarnedMissingTreeSitterWorker = true;
	console.warn(
		'[btca] Standalone Tree-sitter worker asset not found. Continuing without syntax highlighting worker override.'
	);
};

/**
 * Launch the interactive TUI
 */
export async function launchTui(options: TuiOptions): Promise<void> {
	const server = await ensureServer({
		serverUrl: options.server,
		port: options.port
	});

	try {
		const client = createClient(server.url);
		const config = await getConfig(client);
		setTelemetryContext({ provider: config.provider, model: config.model });
	} catch {
		// Ignore config failures for telemetry
	}

	await trackTelemetryEvent({
		event: 'cli_started',
		properties: { command: 'btca', mode: 'tui' }
	});
	await trackTelemetryEvent({
		event: 'cli_tui_started',
		properties: { command: 'btca', mode: 'tui' }
	});

	// Store server reference for TUI to use
	globalThis.__BTCA_SERVER__ = server;
	globalThis.__BTCA_STREAM_OPTIONS__ = {
		showThinking: options.subAgent ? false : (options.thinking ?? true),
		showTools: options.subAgent ? false : (options.tools ?? true)
	};

	ensureStandaloneTreeSitterWorkerPath();

	// Import and run TUI (dynamic import to avoid loading TUI deps when not needed)
	await import('../tui/App.tsx');
}
