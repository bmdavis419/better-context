import { Result } from 'better-result';
import { Command } from 'commander';
import * as readline from 'readline';
import { ensureServer } from '../server/manager.ts';
import {
	createClient,
	getResources,
	getProviders,
	updateModel,
	addResource,
	removeResource,
	BtcaError
} from '../client/index.ts';
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

// Model subcommand
const modelCommand = new Command('model')
	.description('Set the AI model and provider')
	.requiredOption(
		'-p, --provider <provider>',
		'Provider ID (opencode, openrouter, openai, google, anthropic)'
	)
	.requiredOption('-m, --model <model>', 'Model ID (e.g., "claude-haiku-4-5")')
	.action(async (options, command) => {
		const globalOpts = command.parent?.parent?.opts() as
			| { server?: string; port?: number }
			| undefined;

		const result = await Result.tryPromise(async () => {
			const server = await ensureServer({
				serverUrl: globalOpts?.server,
				port: globalOpts?.port,
				quiet: true
			});

			const result = await updateModel(
				server.url,
				options.provider as string,
				options.model as string
			);
			console.log(`Model updated: ${result.provider}/${result.model}`);

			const validationResult = await Result.tryPromise(async () => {
				const client = createClient(server.url);
				const providers = await getProviders(client);
				const provider = providers.all.find((p: { id: string }) => p.id === result.provider);
				if (!provider) {
					console.warn(
						`Warning: Provider "${result.provider}" is not available. ` +
							`Available providers: ${providers.all.map((p: { id: string }) => p.id).join(', ')}`
					);
					return;
				}
				if (!providers.connected.includes(result.provider)) {
					console.warn(
						`Warning: Provider "${result.provider}" is not connected. Run "opencode auth" to configure credentials.`
					);
					return;
				}
				const modelIds = Object.keys(provider.models ?? {});
				if (modelIds.length > 0 && !modelIds.includes(result.model)) {
					console.warn(
						`Warning: Model "${result.model}" not found for provider "${result.provider}". ` +
							`Available models: ${modelIds.join(', ')}`
					);
				}
			});
			if (Result.isError(validationResult)) {
				console.warn(
					`Warning: Unable to validate provider/model. ${validationResult.error instanceof BtcaError ? validationResult.error.message : ''}`.trim()
				);
			}

			server.stop();
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});

// Resources list subcommand
const resourcesListCommand = new Command('list')
	.description('List all configured resources')
	.action(async (_options, command) => {
		const globalOpts = command.parent?.parent?.parent?.opts() as
			| { server?: string; port?: number }
			| undefined;

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

// Resources add subcommand
const resourcesAddCommand = new Command('add')
	.description('Add a new resource')
	.requiredOption('-n, --name <name>', 'Resource name')
	.requiredOption('-t, --type <type>', 'Resource type (git or local)')
	.option('-u, --url <url>', 'Git repository URL (required for git type)')
	.option('-b, --branch <branch>', 'Git branch (default: main)')
	.option('--path <path>', 'Local path (required for local type)')
	.option('--search-path <searchPath...>', 'Subdirectory to focus on (repeatable)')
	.option('--notes <notes>', 'Special notes for the AI')
	.action(async (options, command) => {
		const globalOpts = command.parent?.parent?.parent?.opts() as
			| { server?: string; port?: number }
			| undefined;

		const result = await Result.tryPromise(async () => {
			const server = await ensureServer({
				serverUrl: globalOpts?.server,
				port: globalOpts?.port,
				quiet: true
			});

			const type = options.type as string;

			if (type === 'git') {
				if (!options.url) {
					console.error('Error: --url is required for git resources');
					console.error(
						'\nHint: Use --url to specify the GitHub repository URL (e.g., https://github.com/user/repo).'
					);
					process.exit(1);
				}
				const inputUrl = options.url as string;
				const searchPaths = Array.isArray(options.searchPath)
					? (options.searchPath as string[])
					: options.searchPath
						? [options.searchPath as string]
						: [];
				const added = await addResource(server.url, {
					type: 'git',
					name: options.name as string,
					url: inputUrl,
					branch: (options.branch as string) ?? 'main',
					...(searchPaths.length === 1 && { searchPath: searchPaths[0] }),
					...(searchPaths.length > 1 && { searchPaths }),
					...(options.notes && { specialNotes: options.notes as string })
				});
				// Show normalized URL if it differs from input
				if (added.type === 'git' && added.url !== inputUrl) {
					console.log(`Added git resource: ${options.name}`);
					console.log(`  URL normalized: ${added.url}`);
				} else {
					console.log(`Added git resource: ${options.name}`);
				}
			} else if (type === 'local') {
				if (!options.path) {
					console.error('Error: --path is required for local resources');
					console.error('\nHint: Use --path to specify the local directory path.');
					process.exit(1);
				}
				await addResource(server.url, {
					type: 'local',
					name: options.name as string,
					path: options.path as string,
					...(options.notes && { specialNotes: options.notes as string })
				});
				console.log(`Added local resource: ${options.name}`);
			} else {
				console.error('Error: --type must be "git" or "local"');
				console.error(
					'\nHint: Use -t git for GitHub repositories or -t local for local directories.'
				);
				process.exit(1);
			}

			server.stop();
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});

// Resources remove subcommand
const resourcesRemoveCommand = new Command('remove')
	.description('Remove a resource from the configuration')
	.option('-n, --name <name>', 'Resource name to remove')
	.action(async (options, command) => {
		const globalOpts = command.parent?.parent?.parent?.opts() as
			| { server?: string; port?: number }
			| undefined;

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
			if (options.name) {
				resourceName = options.name as string;
			} else {
				resourceName = await selectSingleResource(resources as ResourceDefinition[]);
			}

			if (!names.includes(resourceName)) {
				console.error(`Error: Resource "${resourceName}" not found.`);
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

// Resources subcommand group
const resourcesCommand = new Command('resources').description('Manage resources');

resourcesCommand.addCommand(resourcesListCommand);
resourcesCommand.addCommand(resourcesAddCommand);
resourcesCommand.addCommand(resourcesRemoveCommand);

// Config command group
export const configCommand = new Command('config').description('Manage btca configuration');

configCommand.addCommand(modelCommand);
configCommand.addCommand(resourcesCommand);
