import { Result } from 'better-result';
import { Command } from 'commander';
import { ensureServer } from '../server/manager.ts';
import { createClient, getResources, BtcaError } from '../client/index.ts';

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

export const resourcesCommand = new Command('resources')
	.description('List all configured resources')
	.action(async (_options, command) => {
		const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;

		const result = await Result.tryPromise(async () => {
			const server = await ensureServer({
				serverUrl: globalOpts?.server,
				port: globalOpts?.port,
				quiet: true
			});

			const client = createClient(server.url);
			const { resources } = await getResources(client);

			if (resources.length === 0) {
				console.log('No resources configured.');
			} else {
				console.log('Configured resources:\n');
				for (const r of resources) {
					if (r.type === 'git') {
						console.log(`  ${r.name} (git)`);
						console.log(`    URL: ${r.url}`);
						console.log(`    Branch: ${r.branch}`);
						if (r.searchPaths && r.searchPaths.length > 0) {
							console.log(`    Search Paths: ${r.searchPaths.join(', ')}`);
						} else if (r.searchPath) {
							console.log(`    Search Path: ${r.searchPath}`);
						}
						if (r.specialNotes) console.log(`    Notes: ${r.specialNotes}`);
					} else if (r.type === 'website') {
						console.log(`  ${r.name} (website)`);
						console.log(`    URL: ${r.url}`);
						console.log(`    Max Pages: ${r.maxPages ?? 200}`);
						console.log(`    Max Depth: ${r.maxDepth ?? 3}`);
						console.log(`    TTL Hours: ${r.ttlHours ?? 24}`);
						if (r.specialNotes) console.log(`    Notes: ${r.specialNotes}`);
					} else {
						console.log(`  ${r.name} (local)`);
						console.log(`    Path: ${r.path}`);
						if (r.specialNotes) console.log(`    Notes: ${r.specialNotes}`);
					}
					console.log('');
				}
			}

			server.stop();
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});
