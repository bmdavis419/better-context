import { Result } from 'better-result';
import { Command } from 'commander';
import * as readline from 'readline';
import { ensureServer } from '../server/manager.ts';
import { createClient, getResources, removeResource, BtcaError } from '../client/index.ts';
import { dim } from '../lib/utils/colors.ts';

/**
 * Resource definition types matching server schema.
 */
interface GitResource {
	type: 'git';
	name: string;
	url: string;
	branch: string;
	searchPath?: string;
	searchPaths?: string[];
	specialNotes?: string;
}

interface LocalResource {
	type: 'local';
	name: string;
	path: string;
	specialNotes?: string;
}

type ResourceDefinition = GitResource | LocalResource;

const isGitResource = (r: ResourceDefinition): r is GitResource => r.type === 'git';

/**
 * Interactive single-select prompt for resources.
 * Displays resource name with dimmed path/URL.
 */
async function selectSingleResource(resources: ResourceDefinition[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});

		console.log('\nSelect a resource to remove:\n');
		resources.forEach((r, idx) => {
			const location = isGitResource(r) ? r.url : r.path;
			console.log(`  ${idx + 1}. ${r.name} ${dim(`(${location})`)}`);
		});
		console.log('');

		rl.question('Enter number: ', (answer) => {
			rl.close();
			const num = parseInt(answer.trim(), 10);
			if (isNaN(num) || num < 1 || num > resources.length) {
				reject(new Error('Invalid selection'));
				return;
			}
			resolve(resources[num - 1]!.name);
		});
	});
}

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

export const removeCommand = new Command('remove')
	.description('Remove a resource from the configuration')
	.argument('[name]', 'Resource name to remove')
	.option(
		'-g, --global',
		'Remove from global config (not implemented yet - removes from active config)'
	)
	.action(async (name: string | undefined, options: { global?: boolean }, command) => {
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
				server.stop();
				return;
			}

			const names = resources.map((r) => r.name);

			// Use provided name or show interactive picker
			let resourceName: string;
			if (name) {
				resourceName = name;
			} else {
				resourceName = await selectSingleResource(resources as ResourceDefinition[]);
			}

			if (!names.includes(resourceName)) {
				console.error(`Error: Resource "${resourceName}" not found.`);
				console.error(`\nAvailable resources: ${names.join(', ')}`);
				server.stop();
				process.exit(1);
			}

			await removeResource(server.url, resourceName);
			console.log(`Removed resource: ${resourceName}`);

			server.stop();
		});

		if (Result.isError(result)) {
			const error = result.error;
			if (error instanceof Error && error.message === 'Invalid selection') {
				console.error('\nError: Invalid selection. Please try again.');
				process.exit(1);
			}
			console.error(formatError(error));
			process.exit(1);
		}
	});
