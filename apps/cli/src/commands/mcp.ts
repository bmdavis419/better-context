import { Result } from 'better-result';
import { Command } from 'commander';
import { McpServer } from 'tmcp';
import { StdioTransport } from '@tmcp/transport-stdio';
import { ZodJsonSchemaAdapter } from '@tmcp/adapter-zod';
import { z } from 'zod';
import path from 'node:path';
import * as readline from 'readline';
import { mkdir } from 'node:fs/promises';
import select from '@inquirer/select';
import { askQuestion, createClient, getResources } from '../client/index.ts';
import { ensureServer } from '../server/manager.ts';
import packageJson from '../../package.json';

declare const __VERSION__: string;
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : (packageJson.version ?? '0.0.0');

const formatError = (error: unknown) =>
	error instanceof Error ? error.message : String(error ?? 'Unknown error');

const textResult = (text: string) => ({
	content: [{ type: 'text' as const, text }]
});

const jsonResult = (value: unknown) => textResult(JSON.stringify(value, null, 2));

const errorResult = (error: unknown) => ({
	content: [{ type: 'text' as const, text: JSON.stringify({ error: formatError(error) }) }],
	isError: true
});

const askSchema = z.object({
	question: z.string().describe('The question to ask about local resources'),
	resources: z
		.array(z.string())
		.optional()
		.describe(
			'Optional resource names or HTTPS GitHub repository URLs to query (defaults to all local resources)'
		)
});
type AskInput = z.infer<typeof askSchema>;

const LOCAL_COMMAND = ['bunx', 'btca', 'mcp'];

const MCP_EDITORS = [
	{ id: 'cursor', label: 'Cursor' },
	{ id: 'opencode', label: 'OpenCode' },
	{ id: 'codex', label: 'Codex' },
	{ id: 'claude', label: 'Claude Code' }
] as const;

type McpEditor = (typeof MCP_EDITORS)[number]['id'];

const promptSelectNumeric = <T extends string>(
	question: string,
	options: { label: string; value: T }[]
) =>
	new Promise<T>((resolve, reject) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});

		console.log(`\n${question}\n`);
		options.forEach((option, index) => {
			console.log(`  ${index + 1}) ${option.label}`);
		});
		console.log('');

		rl.question('Enter number: ', (answer) => {
			rl.close();
			const selection = Number.parseInt(answer.trim(), 10);
			if (!Number.isFinite(selection) || selection < 1 || selection > options.length) {
				reject(new Error('Invalid selection'));
				return;
			}
			const picked = options[selection - 1];
			if (!picked) {
				reject(new Error('Invalid selection'));
				return;
			}
			resolve(picked.value);
		});
	});

const promptSelect = async <T extends string>(
	question: string,
	options: { label: string; value: T }[]
) => {
	if (options.length === 0) {
		throw new Error('Invalid selection');
	}

	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return promptSelectNumeric(question, options);
	}

	const selection = await select({
		message: question,
		choices: options.map((option) => ({
			name: option.label,
			value: option.value
		}))
	});

	return selection as T;
};

const promptEditor = () =>
	promptSelect<McpEditor>(
		'Select your editor:',
		MCP_EDITORS.map((editor) => ({ label: editor.label, value: editor.id }))
	);

const ensureDir = async (dirPath: string) => {
	await mkdir(dirPath, { recursive: true });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const readJsonFile = async (filePath: string) => {
	const file = Bun.file(filePath);
	if (!(await file.exists())) return null;
	const text = await file.text();
	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch (error) {
		throw new Error(`Failed to parse JSON at ${filePath}: ${formatError(error)}`);
	}
};

const writeJsonFile = async (filePath: string, value: unknown) => {
	await ensureDir(path.dirname(filePath));
	await Bun.write(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const updateJsonConfig = async (
	filePath: string,
	update: (current: Record<string, unknown>) => Record<string, unknown>
) => {
	const current = (await readJsonFile(filePath)) ?? {};
	const base = isRecord(current) ? current : {};
	const next = update(base);
	await writeJsonFile(filePath, next);
	return filePath;
};

const upsertMcpServers = (
	current: Record<string, unknown>,
	serverName: string,
	entry: Record<string, unknown>
) => {
	const mcpServers = isRecord(current.mcpServers) ? { ...current.mcpServers } : {};
	mcpServers[serverName] = entry;
	return { ...current, mcpServers };
};

const upsertOpenCode = (
	current: Record<string, unknown>,
	serverName: string,
	entry: Record<string, unknown>
) => {
	const mcp = isRecord(current.mcp) ? { ...current.mcp } : {};
	mcp[serverName] = entry;
	return {
		$schema:
			typeof current.$schema === 'string' ? current.$schema : 'https://opencode.ai/config.json',
		...current,
		mcp
	};
};

const upsertTomlSection = (content: string, header: string, newKeys: Map<string, string>) => {
	const lines = content.split(/\r?\n/);
	const next: string[] = [];
	let inSection = false;
	let replaced = false;
	let found = false;
	const existingKeys = new Map<string, string>();
	let headerLine = '';

	for (const line of lines) {
		const trimmed = line.trim();
		const isHeader = trimmed.startsWith('[') && trimmed.endsWith(']');

		if (isHeader) {
			if (inSection && !replaced) {
				const mergedKeys = new Map([...existingKeys, ...newKeys]);
				next.push(headerLine);
				for (const [key, value] of mergedKeys) {
					next.push(`${key} = ${value}`);
				}
				next.push('');
				replaced = true;
			}

			if (trimmed === header) {
				inSection = true;
				found = true;
				headerLine = line;
				existingKeys.clear();
				continue;
			}

			inSection = false;
		}

		if (inSection) {
			const keyMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=/);
			if (keyMatch?.[1]) {
				const key = keyMatch[1];
				const valueStart = trimmed.indexOf('=') + 1;
				const value = trimmed.slice(valueStart).trim();
				existingKeys.set(key, value);
			}
		} else {
			next.push(line);
		}
	}

	if (inSection && !replaced) {
		const mergedKeys = new Map([...existingKeys, ...newKeys]);
		next.push(headerLine);
		for (const [key, value] of mergedKeys) {
			next.push(`${key} = ${value}`);
		}
		next.push('');
		replaced = true;
	}

	if (!found) {
		const trimmed = next.join('\n').trim();
		const spacer = trimmed.length > 0 ? '\n\n' : '';
		const blockLines = [header];
		for (const [key, value] of newKeys) {
			blockLines.push(`${key} = ${value}`);
		}
		return `${trimmed}${spacer}${blockLines.join('\n')}\n`;
	}

	return `${next.join('\n').trimEnd()}\n`;
};

const writeCodexConfig = async () => {
	const codexDir = path.join(process.cwd(), '.codex');
	const filePath = path.join(codexDir, 'config.toml');
	await ensureDir(codexDir);

	const file = Bun.file(filePath);
	const content = (await file.exists()) ? await file.text() : '';
	const next = upsertTomlSection(
		content,
		'[mcp_servers.btca_local]',
		new Map([
			['command', '"bunx"'],
			['args', '["btca", "mcp"]']
		])
	);

	await Bun.write(filePath, next);
	return filePath;
};

const writeCursorConfig = async () => {
	const filePath = path.join(process.cwd(), '.cursor', 'mcp.json');
	const entry = { command: LOCAL_COMMAND[0], args: LOCAL_COMMAND.slice(1) };
	return updateJsonConfig(filePath, (current) => upsertMcpServers(current, 'btca-local', entry));
};

const writeOpenCodeConfig = async () => {
	const filePath = path.join(process.cwd(), 'opencode.json');
	const entry = {
		type: 'local',
		command: LOCAL_COMMAND,
		enabled: true
	};
	return updateJsonConfig(filePath, (current) => upsertOpenCode(current, 'btca-local', entry));
};

const writeClaudeConfig = async () => {
	const filePath = path.join(process.cwd(), '.mcp.json');
	const entry = {
		type: 'stdio',
		command: LOCAL_COMMAND[0],
		args: LOCAL_COMMAND.slice(1)
	};
	return updateJsonConfig(filePath, (current) => upsertMcpServers(current, 'btca-local', entry));
};

const configureEditor = async (editor: McpEditor) => {
	switch (editor) {
		case 'cursor':
			return writeCursorConfig();
		case 'opencode':
			return writeOpenCodeConfig();
		case 'codex':
			return writeCodexConfig();
		case 'claude':
			return writeClaudeConfig();
	}

	throw new Error(`Unsupported editor: ${editor}`);
};

const runLocalServer = async (command: Command) => {
	const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;

	const serverManager = await ensureServer({
		serverUrl: globalOpts?.server,
		port: globalOpts?.port,
		quiet: true
	});

	const cleanup = () => {
		try {
			serverManager.stop();
		} catch {
			// ignore cleanup errors
		}
	};

	process.once('SIGINT', cleanup);
	process.once('SIGTERM', cleanup);
	process.once('exit', cleanup);

	const client = createClient(serverManager.url);

	const mcpServer = new McpServer(
		{
			name: 'btca-local',
			version: VERSION,
			description: 'Better Context local MCP server (stdio)'
		},
		{
			adapter: new ZodJsonSchemaAdapter(),
			capabilities: {
				tools: { listChanged: false }
			}
		}
	);

	mcpServer.tool(
		{
			name: 'listResources',
			description: 'List all available local resources.'
		},
		async () => {
			const resourcesResult = await Result.tryPromise(() => getResources(client));
			if (Result.isError(resourcesResult)) return errorResult(resourcesResult.error);
			return jsonResult(resourcesResult.value.resources);
		}
	);

	mcpServer.tool(
		{
			name: 'ask',
			description:
				'Ask a question about local resources, or any HTTPS GitHub repository URL passed in as a resource.',
			schema: askSchema
		},
		async (args: AskInput) => {
			const { question, resources } = args;
			const answerResult = await Result.tryPromise(() =>
				askQuestion(client, {
					question,
					resources,
					quiet: true
				})
			);
			if (Result.isError(answerResult)) return errorResult(answerResult.error);
			return textResult(answerResult.value.answer);
		}
	);

	const transport = new StdioTransport(mcpServer);
	transport.listen();
};

const configureLocalMcp = new Command('local')
	.description('Configure local MCP settings for your editor')
	.action(async () => {
		const result = await Result.tryPromise(async () => {
			const editor = await promptEditor();
			const filePath = await configureEditor(editor);
			console.log(`\nLocal MCP configured for ${editor} in: ${filePath}\n`);
		});

		if (Result.isError(result)) {
			if (result.error instanceof Error && result.error.message === 'Invalid selection') {
				console.error('\nError: Invalid selection. Please try again.');
			} else {
				console.error(formatError(result.error));
			}
			process.exit(1);
		}
	});

export const mcpCommand = new Command('mcp')
	.description('Run the local MCP server or configure editor MCP settings')
	.action(async (_options, command) => {
		const result = await Result.tryPromise(() => runLocalServer(command));
		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	})
	.addCommand(configureLocalMcp);
