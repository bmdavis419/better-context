import { Result } from 'better-result';
import { startServer, type ServerInstance } from 'btca-server';

export interface ServerManager {
	url: string;
	stop: () => void;
}

export interface EnsureServerOptions {
	serverUrl?: string;
	port?: number;
	timeout?: number;
	quiet?: boolean;
}

const DEFAULT_TIMEOUT = 10000;

/**
 * Wait for the server to be healthy
 */
const waitForHealth = async (url: string, timeout: number): Promise<void> => {
	const startTime = Date.now();
	const pollInterval = 100;

	while (Date.now() - startTime < timeout) {
		const result = await Result.tryPromise(async () => {
			const response = await fetch(`${url}/`);
			if (!response.ok) return false;
			const data = (await response.json()) as { ok?: boolean };
			return Boolean(data.ok);
		});
		if (Result.isOk(result) && result.value) return;
		await new Promise((resolve) => setTimeout(resolve, pollInterval));
	}

	throw new Error(`Server failed to start within ${timeout}ms`);
};

/**
 * Ensure a btca server is available
 *
 * If serverUrl is provided, uses that server (just health checks it).
 * Otherwise, starts the server in-process.
 */
export async function ensureServer(options: EnsureServerOptions = {}): Promise<ServerManager> {
	const { serverUrl, timeout = DEFAULT_TIMEOUT } = options;

	// If a server URL is provided, just verify it's healthy
	if (serverUrl) {
		await waitForHealth(serverUrl, timeout);
		return {
			url: serverUrl,
			stop: () => {
				// External server, nothing to stop
			}
		};
	}

	// Start the server in-process
	// Use port 0 by default: OS assigns an available ephemeral port (avoids collisions).
	const port = options.port ?? 0;

	const result = await Result.tryPromise(() => startServer({ port, quiet: options.quiet }));
	if (Result.isError(result)) {
		throw new Error(`Failed to start server: ${result.error}`);
	}
	const server: ServerInstance = result.value;

	return {
		url: server.url,
		stop: () => server.stop()
	};
}
