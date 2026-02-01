import { Result } from 'better-result';
import { Command } from 'commander';
import select from '@inquirer/select';
import * as readline from 'readline';
import { ensureServer } from '../server/manager.ts';
import { createClient, getProviders, BtcaError } from '../client/index.ts';
import { removeProviderAuth } from '../lib/opencode-oauth.ts';

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

const isPromptCancelled = (error: unknown) =>
	error instanceof Error &&
	(error.name === 'ExitPromptError' ||
		error.message.toLowerCase().includes('canceled') ||
		error.message.toLowerCase().includes('cancelled'));

/**
 * Prompt for single selection from a list.
 */
async function promptSelect<T extends string>(
	question: string,
	options: { label: string; value: T }[]
) {
	if (options.length === 0) {
		throw new Error('Invalid selection');
	}

	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return new Promise<T>((resolve, reject) => {
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout
			});

			console.log(`\n${question}\n`);
			options.forEach((opt, idx) => {
				console.log(`  ${idx + 1}) ${opt.label}`);
			});
			console.log('');

			rl.question('Enter number: ', (answer) => {
				rl.close();
				const num = parseInt(answer.trim(), 10);
				if (isNaN(num) || num < 1 || num > options.length) {
					reject(new Error('Invalid selection'));
					return;
				}
				resolve(options[num - 1]!.value);
			});
		});
	}

	const selection = await select({
		message: question,
		choices: options.map((option) => ({
			name: option.label,
			value: option.value
		}))
	});
	return selection as T;
}

export const disconnectCommand = new Command('disconnect')
	.description('Disconnect a provider and remove saved credentials')
	.option('-p, --provider <id>', 'Provider ID to disconnect')
	.action(async (options: { provider?: string }, command) => {
		const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;

		const result = await Result.tryPromise(async () => {
			const server = await ensureServer({
				serverUrl: globalOpts?.server,
				port: globalOpts?.port,
				quiet: true
			});

			const client = createClient(server.url);
			const providers = await getProviders(client);

			if (providers.connected.length === 0) {
				console.log('No providers are currently connected.');
				server.stop();
				return;
			}

			const provider =
				options.provider ??
				(await promptSelect(
					'Select a connected provider to disconnect:',
					providers.connected.map((id) => ({ label: id, value: id }))
				));

			if (!providers.connected.includes(provider)) {
				console.error(`Provider "${provider}" is not connected.`);
				server.stop();
				process.exit(1);
			}

			const removed = await removeProviderAuth(provider);
			if (!removed) {
				console.warn(
					`No saved credentials found for "${provider}". If it's still connected, check env vars.`
				);
			} else {
				console.log(`Disconnected "${provider}" and removed saved credentials.`);
			}

			server.stop();
		});

		if (Result.isError(result)) {
			const error = result.error;
			if (error instanceof Error && error.message === 'Invalid selection') {
				console.error('\nError: Invalid selection. Please try again.');
				process.exit(1);
			}
			if (isPromptCancelled(error)) {
				console.log('\nSelection cancelled.');
				process.exit(0);
			}
			console.error(formatError(error));
			process.exit(1);
		}
	});
