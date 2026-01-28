import { Command } from 'commander';
import { spawn } from 'bun';
import { Effect } from 'effect';
import { createClient, getResources, getOpencodeInstance, BtcaError } from '../client/index.ts';
import { exitWith } from '../effect/cli-exit.ts';
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

export const chatCommand = new Command('chat')
	.description('Start an interactive OpenCode TUI session for resources')
	.option('-r, --resource <name...>', 'Resources to include (can specify multiple)')
	.action((options, command) => {
		const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;

		const program = Effect.scoped(
			Effect.gen(function* () {
				const server = yield* withServer({
					serverUrl: globalOpts?.server,
					port: globalOpts?.port
				});

				yield* Effect.tryPromise(async () => {
					const client = createClient(server.url);

					let resourceNames = (options.resource as string[] | undefined) ?? [];

					// If no resources specified, use all available
					if (resourceNames.length === 0) {
						const { resources } = await getResources(client);
						if (resources.length === 0) {
							console.error('Error: No resources configured.');
							console.error('Add resources to your btca config file.');
							exitWith(1, true);
						}
						resourceNames = resources.map((r) => r.name);
					}

					console.log(`Loading resources: ${resourceNames.join(', ')}...`);

					// Get OpenCode instance URL from server
					const { url: opencodeUrl, model } = await getOpencodeInstance(client, {
						resources: resourceNames,
						quiet: false
					});

					console.log(`Starting OpenCode TUI (${model.provider}/${model.model})...\n`);

					// Spawn opencode CLI and attach to the server URL
					const proc = spawn(['opencode', 'attach', opencodeUrl], {
						stdin: 'inherit',
						stdout: 'inherit',
						stderr: 'inherit'
					});

					await proc.exited;
				});
			})
		);

		void runCli(program, {
			onError: (error) => {
				console.error(formatError(error));
			}
		});
	});
