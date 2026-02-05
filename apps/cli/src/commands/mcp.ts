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
		.describe('Optional resource names to query (defaults to all local resources)')
});
type AskInput = z.infer<typeof askSchema>;

const MCP_REMOTE_URL = 'https://btca.dev/api/mcp';
const MCP_API_KEY_URL = 'https://btca.dev/app/settings?tab=mcp';
const API_KEY_PLACEHOLDER = 'btca_xxxxxxxxx';
const LOCAL_COMMAND = ['bunx', 'btca', 'mcp'];

const MCP_EDITORS = [
	{ id: 'cursor', label: 'Cursor' },
	{ id: 'opencode', label: 'OpenCode' },
	{ id: 'codex', label: 'Codex' },
	{ id: 'claude', label: 'Claude Code' }
] as const;

type McpEditor = (typeof MCP_EDITORS)[number]['id'];
type McpMode = 'local' | 'remote';

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

const upsertTomlSection = (content: string, header: string, blockLines: string[]) => {
	const lines = content.split(/\r?\n/);
	const next: string[] = [];
	let inSection = false;
	let replaced = false;
	let found = false;

	for (const line of lines) {
		const trimmed = line.trim();
		const isHeader = trimmed.startsWith('[') && trimmed.endsWith(']');

		if (isHeader) {
			if (inSection && !replaced) {
				next.push(...blockLines, '');
				replaced = true;
			}

			if (trimmed === header) {
				inSection = true;
				found = true;
				continue;
			}

			inSection = false;
		}

		if (!inSection) next.push(line);
	}

	if (inSection && !replaced) {
		next.push(...blockLines, '');
		replaced = true;
	}

	if (!found) {
		const trimmed = next.join('\n').trim();
		const spacer = trimmed.length > 0 ? '\n\n' : '';
		return `${trimmed}${spacer}${blockLines.join('\n')}\n`;
	}

	return `${next.join('\n').trimEnd()}\n`;
};

const writeCodexConfig = async (mode: McpMode) => {
	const codexDir = path.join(process.cwd(), '.codex');
	const filePath = path.join(codexDir, 'config.toml');
	await ensureDir(codexDir);

	const file = Bun.file(filePath);
	const content = (await file.exists()) ? await file.text() : '';
	const header = mode === 'local' ? '[mcp_servers.btca_local]' : '[mcp_servers.btca]';
	const blockLines =
		mode === 'local'
			? [header, 'command = "bunx"', 'args = ["btca", "mcp"]']
			: [
					header,
					`url = "${MCP_REMOTE_URL}"`,
					`http_headers = { Authorization = "Bearer ${API_KEY_PLACEHOLDER}" }`
				];

	const next = upsertTomlSection(content, header, blockLines);
	await Bun.write(filePath, next);
	return filePath;
};

const writeCursorConfig = async (mode: McpMode) => {
	const filePath = path.join(process.cwd(), '.cursor', 'mcp.json');
	const serverName = mode === 'local' ? 'btca-local' : 'btca';
	const entry =
		mode === 'local'
			? { command: LOCAL_COMMAND[0], args: LOCAL_COMMAND.slice(1) }
			: {
					url: MCP_REMOTE_URL,
					headers: {
						Authorization: `Bearer ${API_KEY_PLACEHOLDER}`
					}
				};

	return updateJsonConfig(filePath, (current) => upsertMcpServers(current, serverName, entry));
};

const writeOpenCodeConfig = async (mode: McpMode) => {
	const filePath = path.join(process.cwd(), 'opencode.json');
	const serverName = mode === 'local' ? 'btca-local' : 'btca';
	const entry =
		mode === 'local'
			? {
					type: 'local',
					command: LOCAL_COMMAND,
					enabled: true
				}
			: {
					type: 'remote',
					url: MCP_REMOTE_URL,
					enabled: true,
					headers: {
						Authorization: `Bearer ${API_KEY_PLACEHOLDER}`
					}
				};

	return updateJsonConfig(filePath, (current) => upsertOpenCode(current, serverName, entry));
};

const writeClaudeConfig = async (mode: McpMode) => {
	const filePath = path.join(process.cwd(), '.mcp.json');
	const serverName = mode === 'local' ? 'btca-local' : 'btca';
	const entry =
		mode === 'local'
			? {
					type: 'stdio',
					command: LOCAL_COMMAND[0],
					args: LOCAL_COMMAND.slice(1)
				}
			: {
					type: 'http',
					url: MCP_REMOTE_URL,
					headers: {
						Authorization: `Bearer ${API_KEY_PLACEHOLDER}`
					}
				};

	return updateJsonConfig(filePath, (current) => upsertMcpServers(current, serverName, entry));
};

const configureEditor = async (mode: McpMode, editor: McpEditor) => {
	switch (editor) {
		case 'cursor':
			return writeCursorConfig(mode);
		case 'opencode':
			return writeOpenCodeConfig(mode);
		case 'codex':
			return writeCodexConfig(mode);
		case 'claude':
			return writeClaudeConfig(mode);
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
			description: 'Ask a question about local resources.',
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

const configureMcp = (mode: McpMode) =>
	new Command(mode)
		.description(`Configure ${mode} MCP settings for your editor`)
		.action(async () => {
			const result = await Result.tryPromise(async () => {
				const editor = await promptEditor();
				const filePath = await configureEditor(mode, editor);
				const modeLabel = mode === 'local' ? 'Local' : 'Remote';
				console.log(`\n${modeLabel} MCP configured for ${editor} in: ${filePath}\n`);

				if (mode === 'remote') {
					console.log('Replace the stubbed API key in your config.');
					console.log(`Get a key here: ${MCP_API_KEY_URL}\n`);
				}
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
	.addCommand(configureMcp('local'))
	.addCommand(configureMcp('remote'));
