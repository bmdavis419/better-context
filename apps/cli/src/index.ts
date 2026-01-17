import { Command } from 'commander';
import { askCommand } from './commands/ask.ts';
import { chatCommand } from './commands/chat.ts';
import { configCommand } from './commands/config.ts';
import { clearCommand } from './commands/clear.ts';
import { serveCommand } from './commands/serve.ts';
import { launchTui } from './commands/tui.ts';
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
	.option('--port <port>', 'Port for auto-started server (default: random)', parseInt);

program.addCommand(askCommand);
program.addCommand(chatCommand);
program.addCommand(configCommand);
program.addCommand(clearCommand);
program.addCommand(serveCommand);

// Default action (no subcommand) → launch TUI
program.action(async (options: { server?: string; port?: number }) => {
	try {
		await launchTui(options);
	} catch (error) {
		console.error('Error:', error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
});

program.parse();
