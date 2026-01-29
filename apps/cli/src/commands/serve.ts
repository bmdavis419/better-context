import { Result } from 'better-result';
import { Command } from 'commander';
import { startServer } from 'btca-server';

const DEFAULT_PORT = 8080;

/**
 * Format an error for display.
 * Server errors may have hints attached.
 */
function formatError(error: unknown): string {
	if (error && typeof error === 'object' && 'hint' in error) {
		const e = error as { message?: string; hint?: string };
		let output = `Error: ${e.message ?? String(error)}`;
		if (e.hint) {
			output += `\n\nHint: ${e.hint}`;
		}
		return output;
	}
	return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

export const serveCommand = new Command('serve')
	.description('Start the btca server and listen for requests')
	.option('-p, --port <port>', 'Port to listen on (default: 8080)')
	.action(async (options: { port?: string }) => {
		const port = options.port ? parseInt(options.port, 10) : DEFAULT_PORT;

		const result = await Result.tryPromise(async () => {
			console.log(`Starting btca server on port ${port}...`);
			const server = await startServer({ port });
			console.log(`btca server running at ${server.url}`);
			console.log('Press Ctrl+C to stop');

			// Handle graceful shutdown
			const shutdown = () => {
				console.log('\nShutting down server...');
				server.stop();
				process.exit(0);
			};

			process.on('SIGINT', shutdown);
			process.on('SIGTERM', shutdown);

			// Keep the process alive
			await new Promise(() => {
				// Never resolves - keeps the server running
			});
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});
