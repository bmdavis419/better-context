import { Result } from 'better-result';
import { Command } from 'commander';
import { spawn } from 'bun';
import { ensureServer } from '../server/manager.ts';
import { createClient, getResources, getOpencodeInstance, BtcaError } from '../client/index.ts';

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
	.action(async (options, command) => {
		const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;

		const result = await Result.tryPromise(async () => {
			const server = await ensureServer({
				serverUrl: globalOpts?.server,
				port: globalOpts?.port
			});

			const client = createClient(server.url);

			let resourceNames = (options.resource as string[] | undefined) ?? [];

			// If no resources specified, use all available
			if (resourceNames.length === 0) {
				const { resources } = await getResources(client);
				if (resources.length === 0) {
					console.error('Error: No resources configured.');
					console.error('Add resources to your btca config file.');
					process.exit(1);
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

			server.stop();
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});
