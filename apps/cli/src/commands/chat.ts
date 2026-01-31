import { Result } from 'better-result';
import { Command } from 'commander';
import { spawn } from 'bun';
import * as readline from 'readline';
import { ensureServer } from '../server/manager.ts';
import { createClient, getResources, getOpencodeInstance, BtcaError } from '../client/index.ts';
import { RemoteClient, type RemoteThread } from '../client/remote.ts';
import { loadAuth } from '../lib/auth.ts';
import { dim } from '../lib/utils/colors.ts';

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
	.option('--thread [id]', 'Resume a previous thread (omit id to select from list)')
	.option('--project <name>', 'Remote project name (for thread lookup)')
	.action(async (options, command) => {
		const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;

		const result = await Result.tryPromise(async () => {
			const threadOption = options.thread as string | boolean | undefined;

			if (threadOption !== undefined) {
				const auth = await loadAuth();
				if (!auth) {
					console.error('Error: No remote auth found.');
					console.error('Run "btca remote link" to authenticate before resuming a thread.');
					process.exit(1);
				}

				const remoteClient = new RemoteClient({ apiKey: auth.apiKey });
				const projectName = options.project as string | undefined;

				const threadId =
					typeof threadOption === 'string'
						? threadOption
						: await selectThread(remoteClient, projectName);

				console.log('Waking remote instance...\n');
				const wakeResult = await remoteClient.wake();
				if (!wakeResult.ok) {
					console.error(`Error: ${wakeResult.error}`);
					process.exit(1);
				}

				const opencodeArgs = ['opencode', 'attach', wakeResult.serverUrl, '--thread', threadId];
				console.log(`Resuming thread ${threadId}...\n`);

				const proc = spawn(opencodeArgs, {
					stdin: 'inherit',
					stdout: 'inherit',
					stderr: 'inherit'
				});

				await proc.exited;
				return;
			}

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

async function selectThread(client: RemoteClient, project?: string): Promise<string> {
	const listResult = await client.listThreads(project);
	if (!listResult.ok) {
		console.error(`Error: ${listResult.error}`);
		process.exit(1);
	}

	const threads = listResult.threads;
	if (threads.length === 0) {
		console.error('No threads found to resume.');
		process.exit(1);
	}

	const selected = await promptThreadSelection(threads);
	return selected._id;
}

function formatThreadLabel(thread: RemoteThread, index: number): string {
	const title = thread.title?.trim() ? thread.title.trim() : 'Untitled thread';
	const lastActive = new Date(thread.lastActivityAt).toLocaleString();
	return `${index + 1}) ${title} ${dim(`(last active ${lastActive})`)}`;
}

async function promptThreadSelection(threads: RemoteThread[]): Promise<RemoteThread> {
	return new Promise((resolve, reject) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});

		console.log('\nSelect a thread to resume:\n');
		threads.forEach((thread, index) => {
			console.log(`  ${formatThreadLabel(thread, index)}`);
		});
		console.log('');

		rl.question('Enter number: ', (answer) => {
			rl.close();
			const num = parseInt(answer.trim(), 10);
			if (isNaN(num) || num < 1 || num > threads.length) {
				reject(new Error('Invalid selection'));
				return;
			}
			resolve(threads[num - 1]!);
		});
	});
}
