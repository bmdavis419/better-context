import { Command } from 'commander';
import { spawn } from 'bun';
import { BtcaError } from '../client/index.ts';

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

export const authCommand = new Command('auth')
	.description('Connect a provider using OpenCode authentication')
	.argument('[provider]', 'Provider ID (e.g., openai, anthropic)')
	.action(async (provider: string | undefined) => {
		try {
			console.log('Starting OpenCode auth...');
			if (provider) console.log(`When prompted, choose provider: ${provider}`);
			const args = ['opencode', 'auth', 'login'];
			const proc = spawn(args, {
				stdin: 'inherit',
				stdout: 'inherit',
				stderr: 'inherit'
			});
			const exitCode = await proc.exited;
			if (exitCode !== 0) process.exit(exitCode);
		} catch (error) {
			console.error(formatError(error));
			console.error(
				'Ensure `opencode-ai` is installed and on your PATH. You can also run `opencode auth login` directly.'
			);
			process.exit(1);
		}
	});
