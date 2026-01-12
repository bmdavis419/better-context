import { Command } from 'commander';
import { startServer } from '@btca/server';

const DEFAULT_PORT = 8080;

export const serveCommand = new Command('serve')
	.description('Start the btca server and listen for requests')
	.option('-p, --port <port>', 'Port to listen on (default: 8080)')
	.action(async (options: { port?: string }) => {
		const port = options.port ? parseInt(options.port, 10) : DEFAULT_PORT;

		try {
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
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	});
