import { ensureServer, type ServerManager } from '../server/manager.ts';

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

/**
 * Launch the interactive TUI
 */
export async function launchTui(options: TuiOptions): Promise<void> {
	const server = await ensureServer({
		serverUrl: options.server,
		port: options.port
	});

	// Store server reference for TUI to use
	globalThis.__BTCA_SERVER__ = server;
	globalThis.__BTCA_STREAM_OPTIONS__ = {
		showThinking: options.subAgent ? false : (options.thinking ?? true),
		showTools: options.subAgent ? false : (options.tools ?? true)
	};

	// Import and run TUI (dynamic import to avoid loading TUI deps when not needed)
	await import('../tui/App.tsx');
}
