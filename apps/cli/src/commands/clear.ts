import { Command } from 'commander';
import { Effect } from 'effect';
import { clearResources, BtcaError } from '../client/index.ts';
import { runCli } from '../effect/runner.ts';
import { withServer } from '../effect/server-manager.ts';

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
	.action((_options, command) => {
		const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;

		const program = Effect.scoped(
			Effect.gen(function* () {
				const server = yield* withServer({
					serverUrl: globalOpts?.server,
					port: globalOpts?.port,
					quiet: true
				});

				yield* Effect.tryPromise(async () => {
					const result = await clearResources(server.url);
					console.log(`Cleared ${result.cleared} resource(s).`);
				});
			})
		);

		void runCli(program, {
			onError: (error) => {
				console.error(formatError(error));
			}
		});
	});
