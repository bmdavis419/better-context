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
 * Get a random port in the range 3000-6000
 */
const getRandomPort = (): number => Math.floor(Math.random() * 3000) + 3000;

/**
 * Wait for the server to be healthy
 */
const waitForHealth = async (url: string, timeout: number): Promise<void> => {
	const startTime = Date.now();
	const pollInterval = 100;

	while (Date.now() - startTime < timeout) {
		try {
			const response = await fetch(`${url}/`);
			if (response.ok) {
				const data = (await response.json()) as { ok?: boolean };
				if (data.ok) return;
			}
		} catch {
			// Server not ready yet
		}
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
	const port = options.port ?? getRandomPort();

	let server: ServerInstance;
	try {
		server = await startServer({ port, quiet: options.quiet });
	} catch (error) {
		throw new Error(`Failed to start server: ${error}`);
	}

	return {
		url: server.url,
		stop: () => server.stop()
	};
}
