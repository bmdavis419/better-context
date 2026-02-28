import { Result } from 'better-result';
import { Command } from 'commander';
import { addCommand } from './commands/add.ts';
import { askCommand } from './commands/ask.ts';
import { clearCommand } from './commands/clear.ts';
import { configCommand } from './commands/config.ts';
import { connectCommand } from './commands/connect.ts';
import { disconnectCommand } from './commands/disconnect.ts';
import { initCommand } from './commands/init.ts';
import { statusCommand } from './commands/status.ts';
import { mcpCommand } from './commands/mcp.ts';
import { removeCommand } from './commands/remove.ts';
import { referenceCommand } from './commands/reference.ts';
import { resourcesCommand } from './commands/resources.ts';
import { serveCommand } from './commands/serve.ts';
import { skillCommand } from './commands/skill.ts';
import { telemetryCommand } from './commands/telemetry.ts';
import { launchTui } from './commands/tui.ts';
import { launchRepl } from './commands/repl.ts';
import { wipeCommand } from './commands/wipe.ts';
import { setTelemetryContext } from './lib/telemetry.ts';
import packageJson from '../package.json';

// Version is injected at build time via Bun's define option
// The __VERSION__ global is replaced with the actual version string during compilation
// Falls back to package.json for dev mode, or 0.0.0 if unavailable
declare const __VERSION__: string;
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : (packageJson.version ?? '0.0.0');
setTelemetryContext({ cliVersion: VERSION });

const program = new Command()
	.name('btca')
	.description('CLI for asking questions about technologies using btca server')
	.version(VERSION, '-v, --version', 'output the version number')
	.enablePositionalOptions()
	.option('--server <url>', 'Use an existing btca server URL')
	.option('--port <port>', 'Port for auto-started server (default: 0, OS-assigned)', parseInt)
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
program.addCommand(referenceCommand);
program.addCommand(resourcesCommand);

// Query commands
program.addCommand(askCommand);

// Configuration commands
program.addCommand(connectCommand);
program.addCommand(configCommand);
program.addCommand(disconnectCommand);
program.addCommand(initCommand);
program.addCommand(statusCommand);
program.addCommand(skillCommand);

// Utility commands
program.addCommand(clearCommand);
program.addCommand(wipeCommand);
program.addCommand(mcpCommand);
program.addCommand(serveCommand);

program.addCommand(telemetryCommand);

const knownCommands = new Set(
	program.commands.flatMap((command) => [command.name(), ...command.aliases()])
);

const distance = (left: string, right: string): number => {
	const matrix = Array.from({ length: left.length + 1 }, () =>
		Array.from({ length: right.length + 1 }, () => 0)
	);

	for (let col = 1; col <= right.length; col += 1) {
		matrix[0]![col] = col;
	}

	for (let row = 1; row <= left.length; row += 1) {
		matrix[row]![0] = row;
	}

	for (let row = 1; row <= left.length; row += 1) {
		for (let col = 1; col <= right.length; col += 1) {
			const currentRow = matrix[row]!;
			const previousRow = matrix[row - 1]!;

			currentRow[col] =
				left[row - 1] === right[col - 1]
					? previousRow[col - 1]!
					: Math.min(previousRow[col]! + 1, currentRow[col - 1]! + 1, previousRow[col - 1]! + 1);
		}
	}

	return matrix[left.length]![right.length]!;
};

const suggestCommand = (token: string) => {
	let suggestion: string | null = null;
	let bestDistance = Infinity;

	for (const command of knownCommands) {
		const nextDistance = distance(token, command);
		if (nextDistance < bestDistance) {
			suggestion = command;
			bestDistance = nextDistance;
		}
	}

	return bestDistance <= 2 ? suggestion : null;
};

const firstOperand = (): string | null => {
	const parsed = program.parseOptions(process.argv.slice(2));
	const [operand] = parsed.operands;
	return typeof operand === 'string' && operand.length > 0 ? operand : null;
};

const unknownTopLevelCommand = () => {
	const token = firstOperand();
	if (token === null) return null;
	return knownCommands.has(token) ? null : token;
};

const commandLike = (value: unknown): value is Command => {
	return Boolean(
		value &&
		typeof value === 'object' &&
		'name' in value &&
		typeof (value as { name?: unknown }).name === 'function'
	);
};

const rootOptionsLike = (value: unknown) =>
	Boolean(
		value &&
		typeof value === 'object' &&
		('server' in value ||
			'port' in value ||
			'tui' in value ||
			'thinking' in value ||
			'tools' in value ||
			'subAgent' in value)
	);

const handleUnknownTopLevelCommand = (token: string) => {
	const suggestion = suggestCommand(token);
	const hint = suggestion ? ` (Did you mean '${suggestion}'?)` : '';
	console.error(`error: unknown command '${token}'${hint}`);
	process.exit(1);
};

const token = unknownTopLevelCommand();

if (token !== null) {
	handleUnknownTopLevelCommand(token);
}

// Default action (no subcommand) → launch TUI or REPL
program.action(async (...actionArgs: unknown[]) => {
	const command = actionArgs[actionArgs.length - 1];
	const options = actionArgs.length > 1 ? actionArgs[actionArgs.length - 2] : actionArgs[0];

	if (!commandLike(command) || !rootOptionsLike(options)) {
		console.error('error: invalid command invocation');
		process.exit(1);
	}

	const typedOptions = options as {
		server?: string;
		port?: number;
		tui?: boolean;
		thinking?: boolean;
		tools?: boolean;
		subAgent?: boolean;
	};

	const result = await Result.tryPromise(async () => {
		// --no-tui sets tui to false
		if (typedOptions.tui === false) {
			await launchRepl(typedOptions);
		} else {
			await launchTui(typedOptions);
		}
	});

	if (Result.isError(result)) {
		console.error(
			'Error:',
			result.error instanceof Error ? result.error.message : String(result.error)
		);
		process.exit(1);
	}
});

program.parse();
