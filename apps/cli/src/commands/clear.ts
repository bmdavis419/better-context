import { Result } from 'better-result';
import { Command } from 'commander';
import { ensureServer } from '../server/manager.ts';
import { clearResources, BtcaError } from '../client/index.ts';

/**
 * Format an error for display, including hint if available.
 */
function formatError(error: unknown): string {
	if (error instanceof BtcaError) {
		let output = `Error: ${error.message}`;
		if (error.hint) {
			output += `\n\nHint: ${error.hint}`;
		}
		return output;
	}
	return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

export const clearCommand = new Command('clear')
	.description('Clear all locally cloned resources')
	.action(async (_options, command) => {
		const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;

		const result = await Result.tryPromise(async () => {
			const server = await ensureServer({
				serverUrl: globalOpts?.server,
				port: globalOpts?.port,
				quiet: true
			});

			const result = await clearResources(server.url);
			console.log(`Cleared ${result.cleared} resource(s).`);

			server.stop();
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});
