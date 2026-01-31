import { Result } from 'better-result';
import { Command } from 'commander';
import { addCommand } from './commands/add.ts';
import { askCommand } from './commands/ask.ts';
import { clearCommand } from './commands/clear.ts';
import { connectCommand } from './commands/connect.ts';
import { initCommand } from './commands/init.ts';
import { removeCommand } from './commands/remove.ts';
import { remoteCommand } from './commands/remote.ts';
import { serveCommand } from './commands/serve.ts';
import { launchTui } from './commands/tui.ts';
import { launchRepl } from './commands/repl.ts';
import packageJson from '../package.json';

// Version is injected at build time via Bun's define option
// The __VERSION__ global is replaced with the actual version string during compilation
// Falls back to package.json for dev mode, or 0.0.0 if unavailable
declare const __VERSION__: string;
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : (packageJson.version ?? '0.0.0');

const program = new Command()
	.name('btca')
	.description('CLI for asking questions about technologies using btca server')
	.version(VERSION, '-v, --version', 'output the version number')
	.enablePositionalOptions()
	.option('--server <url>', 'Use an existing btca server URL')
	.option('--port <port>', 'Port for auto-started server (default: random)', parseInt)
	.option(
		'--no-tui',
		'Use simple REPL mode instead of TUI (useful for Windows or minimal terminals)'
	)
	.option('--no-thinking', 'Hide reasoning output in REPL mode')
	.option('--no-tools', 'Hide tool-call traces in REPL mode')
	.option('--sub-agent', 'Emit clean output (no reasoning/tool traces) in REPL mode');

// Resource management commands
program.addCommand(addCommand);
program.addCommand(removeCommand);

// Query commands
program.addCommand(askCommand);

// Configuration commands
program.addCommand(connectCommand);
program.addCommand(initCommand);

// Utility commands
program.addCommand(clearCommand);
program.addCommand(serveCommand);

// Remote mode commands
program.addCommand(remoteCommand);

// Default action (no subcommand) → launch TUI or REPL
program.action(
	async (options: {
		server?: string;
		port?: number;
		tui?: boolean;
		thinking?: boolean;
		tools?: boolean;
		subAgent?: boolean;
	}) => {
		const result = await Result.tryPromise(async () => {
			// --no-tui sets tui to false
			if (options.tui === false) {
				await launchRepl(options);
			} else {
				await launchTui(options);
			}
		});

		if (Result.isError(result)) {
			console.error(
				'Error:',
				result.error instanceof Error ? result.error.message : String(result.error)
			);
			process.exit(1);
		}
	}
);

program.parse();
