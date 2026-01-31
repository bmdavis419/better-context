import { Result } from 'better-result';
import { Command } from 'commander';
import * as readline from 'readline';
import {
	RemoteClient,
	RemoteApiError,
	type GitResource,
	type RemoteConfig
} from '../client/remote.ts';
import { loadAuth, saveAuth, deleteAuth, type RemoteAuth } from '../lib/auth.ts';
import { dim, green, red, yellow, bold } from '../lib/utils/colors.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Config Constants
// ─────────────────────────────────────────────────────────────────────────────

const REMOTE_CONFIG_FILENAME = 'btca.remote.config.jsonc';
const REMOTE_CONFIG_SCHEMA_URL = 'https://btca.dev/btca.remote.schema.json';

async function requireAuth(): Promise<RemoteClient> {
	const auth = await loadAuth();
	if (!auth) {
		console.error(red('Not authenticated with remote.'));
		console.error(`Run ${bold('btca remote link')} to authenticate.`);
		process.exit(1);
	}
	return new RemoteClient({ apiKey: auth.apiKey });
}

// ─────────────────────────────────────────────────────────────────────────────
// Remote Config Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getConfigPath(cwd: string = process.cwd()): string {
	return `${cwd}/${REMOTE_CONFIG_FILENAME}`;
}

async function loadConfig(cwd: string = process.cwd()): Promise<RemoteConfig | null> {
	const configPath = getConfigPath(cwd);
	const result = await Result.tryPromise(async () => {
		const content = await Bun.file(configPath).text();
		const stripped = stripJsonComments(content);
		return JSON.parse(stripped) as RemoteConfig;
	});
	return Result.isOk(result) ? result.value : null;
}

function stripJsonComments(content: string): string {
	let result = '';
	let inString = false;
	let inLineComment = false;
	let inBlockComment = false;
	let i = 0;

	while (i < content.length) {
		const char = content[i];
		const next = content[i + 1];

		if (inLineComment) {
			if (char === '\n') {
				inLineComment = false;
				result += char;
			}
			i++;
			continue;
		}

		if (inBlockComment) {
			if (char === '*' && next === '/') {
				inBlockComment = false;
				i += 2;
				continue;
			}
			i++;
			continue;
		}

		if (inString) {
			result += char;
			if (char === '\\' && i + 1 < content.length) {
				result += content[i + 1];
				i += 2;
				continue;
			}
			if (char === '"') {
				inString = false;
			}
			i++;
			continue;
		}

		if (char === '"') {
			inString = true;
			result += char;
			i++;
			continue;
		}

		if (char === '/' && next === '/') {
			inLineComment = true;
			i += 2;
			continue;
		}

		if (char === '/' && next === '*') {
			inBlockComment = true;
			i += 2;
			continue;
		}

		result += char;
		i++;
	}

	return result.replace(/,(\s*[}\]])/g, '$1');
}

async function saveConfig(config: RemoteConfig, cwd: string = process.cwd()): Promise<void> {
	const configPath = getConfigPath(cwd);
	const toSave = {
		$schema: REMOTE_CONFIG_SCHEMA_URL,
		...config
	};
	await Bun.write(configPath, JSON.stringify(toSave, null, '\t'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createRl(): readline.Interface {
	return readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
}

async function promptInput(
	rl: readline.Interface,
	question: string,
	defaultValue?: string
): Promise<string> {
	return new Promise((resolve) => {
		const defaultHint = defaultValue ? ` ${dim(`(${defaultValue})`)}` : '';
		rl.question(`${question}${defaultHint}: `, (answer) => {
			const value = answer.trim();
			resolve(value || defaultValue || '');
		});
	});
}

async function promptConfirm(rl: readline.Interface, question: string): Promise<boolean> {
	return new Promise((resolve) => {
		rl.question(`${question} ${dim('(y/n)')}: `, (answer) => {
			resolve(answer.trim().toLowerCase() === 'y');
		});
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Formatting
// ─────────────────────────────────────────────────────────────────────────────

function formatError(error: unknown): string {
	if (error instanceof RemoteApiError) {
		let output = `Error: ${error.message}`;
		if (error.hint) {
			output += `\n\nHint: ${error.hint}`;
		}
		return output;
	}
	return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcommands
// ─────────────────────────────────────────────────────────────────────────────

/**
 * btca remote link - Authenticate with remote instance
 */
const linkCommand = new Command('link')
	.description('Authenticate with the btca cloud service')
	.option('--key <apiKey>', 'API key (if you have one already)')
	.action(async (options: { key?: string }) => {
		const result = await Result.tryPromise(async () => {
			const existingAuth = await loadAuth();
			if (existingAuth) {
				const rl = createRl();
				const overwrite = await promptConfirm(
					rl,
					'You are already authenticated. Do you want to re-authenticate?'
				);
				rl.close();
				if (!overwrite) {
					console.log('Cancelled.');
					return;
				}
			}

			let apiKey = options.key;

			if (!apiKey) {
				console.log('\n--- btca Remote Authentication ---\n');
				console.log('To authenticate, you need an API key from the btca web app.');
				console.log(`\n1. Go to ${bold('https://btca.dev/app/settings?tab=mcp')}`);
				console.log('2. Create a new API key');
				console.log('3. Copy the key and paste it below\n');

				const rl = createRl();
				apiKey = await promptInput(rl, 'API Key');
				rl.close();

				if (!apiKey) {
					console.error(red('API key is required.'));
					process.exit(1);
				}
			}

			// Validate the API key
			console.log('\nValidating API key...');
			const client = new RemoteClient({ apiKey });
			const validation = await client.validate();

			if (!validation.valid) {
				console.error(red(`\nAuthentication failed: ${validation.error}`));
				process.exit(1);
			}

			// Save the auth
			await saveAuth({
				apiKey,
				linkedAt: Date.now()
			});

			console.log(green('\nAuthentication successful!'));
			console.log(`\nYou can now use remote commands:`);
			console.log(`  ${dim('btca remote status')}  - Check instance status`);
			console.log(`  ${dim('btca remote ask')}     - Ask questions via cloud`);
			console.log(`  ${dim('btca remote sync')}    - Sync local config with cloud`);
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});

/**
 * btca remote unlink - Remove authentication
 */
const unlinkCommand = new Command('unlink')
	.description('Remove authentication with the btca cloud service')
	.action(async () => {
		const result = await Result.tryPromise(async () => {
			const auth = await loadAuth();
			if (!auth) {
				console.log('Not currently authenticated.');
				return;
			}

			await deleteAuth();
			console.log(green('Successfully unlinked from btca cloud.'));
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});

/**
 * btca remote status - Show sandbox status
 */
const statusCommand = new Command('status')
	.description('Show sandbox and project status')
	.action(async () => {
		const result = await Result.tryPromise(async () => {
			const client = await requireAuth();
			const config = await loadConfig();

			console.log('\n--- btca Remote Status ---\n');

			const result = await client.getStatus(config?.project);

			if (!result.ok) {
				console.error(red(`Error: ${result.error}`));
				process.exit(1);
			}

			const { instance, project } = result;

			// Instance status
			const stateColors: Record<string, (s: string) => string> = {
				running: green,
				stopped: yellow,
				error: red,
				provisioning: yellow,
				starting: yellow,
				stopping: yellow
			};
			const stateColor = stateColors[instance.state] ?? dim;
			console.log(`Sandbox: ${stateColor(instance.state)}`);

			if (instance.subscriptionPlan) {
				console.log(`Plan: ${instance.subscriptionPlan}`);
			}

			if (instance.btcaVersion) {
				console.log(`Version: ${instance.btcaVersion}`);
			}

			// Project info
			if (project) {
				console.log(`\nProject: ${bold(project.name)}${project.isDefault ? ' (default)' : ''}`);
				if (project.model) {
					console.log(`Model: ${project.model}`);
				}
			} else if (config?.project) {
				console.log(`\nLocal project: ${bold(config.project)} (not synced)`);
			}

			// Local config info
			if (config) {
				console.log(`\nLocal resources: ${config.resources.length}`);
			} else {
				console.log(dim(`\nNo local remote config found (${REMOTE_CONFIG_FILENAME})`));
			}

			console.log('');
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});

/**
 * btca remote wake - Pre-warm the sandbox
 */
const wakeCommand = new Command('wake')
	.description('Pre-warm the cloud sandbox')
	.action(async () => {
		const result = await Result.tryPromise(async () => {
			const client = await requireAuth();

			console.log('Waking sandbox...');
			const result = await client.wake();

			if (!result.ok) {
				console.error(red(`Error: ${result.error}`));
				process.exit(1);
			}

			console.log(green('Sandbox is ready!'));
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});

interface GitHubUrlParts {
	owner: string;
	repo: string;
}

function parseGitHubUrl(url: string): GitHubUrlParts | null {
	const patterns = [
		/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/,
		/^github\.com\/([^/]+)\/([^/]+?)(\.git)?$/
	];

	for (const pattern of patterns) {
		const match = url.match(pattern);
		if (match) {
			return { owner: match[1]!, repo: match[2]! };
		}
	}

	return null;
}

function normalizeGitHubUrl(url: string): string {
	const parts = parseGitHubUrl(url);
	if (!parts) return url;
	return `https://github.com/${parts.owner}/${parts.repo}`;
}

async function promptRepeated(rl: readline.Interface, itemName: string): Promise<string[]> {
	const items: string[] = [];

	console.log(`\nEnter ${itemName} one at a time. Press Enter with empty input when done.`);

	while (true) {
		const value = await promptInput(rl, `  ${itemName} ${items.length + 1}`);
		if (!value) break;
		items.push(value);
	}

	return items;
}

async function addRemoteResourceWizard(url: string): Promise<void> {
	const urlParts = parseGitHubUrl(url);
	if (!urlParts) {
		console.error(red('Invalid GitHub URL.'));
		console.error('Expected format: https://github.com/owner/repo');
		process.exit(1);
	}

	const normalizedUrl = normalizeGitHubUrl(url);

	console.log('\n--- Add Remote Resource ---\n');
	console.log(`Repository: ${normalizedUrl}`);

	const rl = createRl();

	const result = await Result.tryPromise(async () => {
		const finalUrl = await promptInput(rl, 'URL', normalizedUrl);

		const defaultName = urlParts.repo;
		const name = await promptInput(rl, 'Name', defaultName);

		const branch = await promptInput(rl, 'Branch', 'main');

		const wantSearchPaths = await promptConfirm(
			rl,
			'Do you want to add search paths (subdirectories to focus on)?'
		);
		const searchPaths = wantSearchPaths ? await promptRepeated(rl, 'Search path') : [];

		const notes = await promptInput(rl, 'Notes (optional)');

		rl.close();

		console.log('\n--- Summary ---\n');
		console.log(`  Type:    git`);
		console.log(`  Name:    ${name}`);
		console.log(`  URL:     ${finalUrl}`);
		console.log(`  Branch:  ${branch}`);
		if (searchPaths.length > 0) {
			console.log(`  Search:  ${searchPaths.join(', ')}`);
		}
		if (notes) {
			console.log(`  Notes:   ${notes}`);
		}
		console.log('');

		const confirmRl = createRl();
		const confirmed = await promptConfirm(confirmRl, 'Add this resource?');
		confirmRl.close();

		if (!confirmed) {
			console.log('\nCancelled.');
			process.exit(0);
		}

		const client = await requireAuth();
		let config = await loadConfig();

		if (!config) {
			const projectRl = createRl();
			const projectName = await promptInput(projectRl, 'Project name for remote config', 'default');
			projectRl.close();

			if (!projectName) {
				console.error(red('Project name is required.'));
				process.exit(1);
			}

			config = {
				project: projectName,
				model: 'claude-haiku',
				resources: []
			};
		}

		const resource: GitResource = {
			type: 'git',
			name,
			url: finalUrl,
			branch,
			...(searchPaths.length === 1 && { searchPath: searchPaths[0] }),
			...(searchPaths.length > 1 && { searchPaths }),
			...(notes && { specialNotes: notes })
		};

		if (config.resources.some((r) => r.name === name)) {
			console.error(red(`Resource "${name}" already exists in config.`));
			process.exit(1);
		}

		config.resources.push(resource);
		await saveConfig(config);

		console.log(`\nAdded "${name}" to local config.`);

		console.log('Syncing to cloud...');
		const syncResult = await client.addResource(resource, config.project);

		if (!syncResult.ok) {
			console.error(yellow(`Warning: Failed to sync to cloud: ${syncResult.error}`));
			console.error('The resource has been added to your local config.');
			console.error(`Run ${bold('btca remote sync')} to try again.`);
		} else {
			console.log(green(`Successfully added and synced "${name}"!`));
		}

		console.log('\nYou can now use this resource:');
		console.log(`  ${dim(`btca remote ask -q "your question" -r ${name}`)}`);
	});

	rl.close();

	if (Result.isError(result)) {
		throw result.error;
	}
}

/**
 * btca remote add - Add resource to remote config and sync
 */
const addCommand = new Command('add')
	.description('Add a resource to remote config and sync to cloud')
	.argument('[url]', 'GitHub repository URL')
	.option('-n, --name <name>', 'Resource name')
	.option('-b, --branch <branch>', 'Git branch (default: main)')
	.option('-s, --search-path <path...>', 'Search paths within repo')
	.option('--notes <notes>', 'Special notes for the agent')
	.action(
		async (
			url: string | undefined,
			options: {
				name?: string;
				branch?: string;
				searchPath?: string[];
				notes?: string;
			}
		) => {
			const result = await Result.tryPromise(async () => {
				if (!url) {
					const rl = createRl();
					const inputUrl = await promptInput(rl, 'GitHub URL');
					rl.close();

					if (!inputUrl) {
						console.error(red('URL is required.'));
						process.exit(1);
					}

					await addRemoteResourceWizard(inputUrl);
					return;
				}

				const urlParts = parseGitHubUrl(url);
				if (!urlParts) {
					console.error(red('Invalid GitHub URL.'));
					console.error('Expected format: https://github.com/owner/repo');
					process.exit(1);
				}

				if (options.name) {
					const normalizedUrl = normalizeGitHubUrl(url);
					const client = await requireAuth();
					let config = await loadConfig();

					if (!config) {
						const rl = createRl();
						const projectName = await promptInput(rl, 'Project name for remote config', 'default');
						rl.close();

						if (!projectName) {
							console.error(red('Project name is required.'));
							process.exit(1);
						}

						config = {
							project: projectName,
							model: 'claude-sonnet',
							resources: []
						};
					}

					const resource: GitResource = {
						type: 'git',
						name: options.name,
						url: normalizedUrl,
						branch: options.branch ?? 'main',
						...(options.searchPath?.length === 1 && { searchPath: options.searchPath[0] }),
						...(options.searchPath &&
							options.searchPath.length > 1 && { searchPaths: options.searchPath }),
						...(options.notes && { specialNotes: options.notes })
					};

					if (config.resources.some((r) => r.name === options.name)) {
						console.error(red(`Resource "${options.name}" already exists in config.`));
						process.exit(1);
					}

					config.resources.push(resource);
					await saveConfig(config);

					console.log(`Added "${options.name}" to local config.`);

					console.log('Syncing to cloud...');
					const syncResult = await client.addResource(resource, config.project);

					if (!syncResult.ok) {
						console.error(yellow(`Warning: Failed to sync to cloud: ${syncResult.error}`));
						console.error('The resource has been added to your local config.');
						console.error(`Run ${bold('btca remote sync')} to try again.`);
					} else {
						console.log(green(`Successfully added and synced "${options.name}"!`));
					}
					return;
				}

				await addRemoteResourceWizard(url);
			});

			if (Result.isError(result)) {
				console.error(formatError(result.error));
				process.exit(1);
			}
		}
	);

/**
 * btca remote sync - Sync local config with cloud
 */
const syncCommand = new Command('sync')
	.description('Sync local remote config with cloud')
	.option('--force', 'Force push local config, overwriting cloud on conflicts')
	.action(async (options: { force?: boolean }) => {
		const result = await Result.tryPromise(async () => {
			const client = await requireAuth();
			const config = await loadConfig();

			if (!config) {
				console.error(red(`No remote config found (${REMOTE_CONFIG_FILENAME}).`));
				console.error('Create a remote config first or use `btca remote add` to start.');
				process.exit(1);
			}

			console.log(`Syncing project "${config.project}"...`);

			const result = await client.sync(config, options.force);

			if (!result.ok) {
				if (result.conflicts && result.conflicts.length > 0) {
					console.error(red('\nConflicts detected:'));
					for (const conflict of result.conflicts) {
						console.error(`\n  ${bold(conflict.name)}:`);
						console.error(`    Local:  ${conflict.local.url} @ ${conflict.local.branch}`);
						console.error(`    Remote: ${conflict.remote.url} @ ${conflict.remote.branch}`);
					}
					console.error(
						`\nUse ${bold('--force')} to overwrite cloud config, or update local config to match.`
					);
				} else if (result.errors) {
					for (const err of result.errors) {
						console.error(red(`Error: ${err}`));
					}
				}
				process.exit(1);
			}

			if (result.synced.length > 0) {
				console.log(green('\nSynced resources:'));
				for (const name of result.synced) {
					console.log(`  - ${name}`);
				}
			} else {
				console.log(green('\nAlready in sync!'));
			}
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});

/**
 * btca remote ask - Ask a question via cloud
 */
const askCommand = new Command('ask')
	.description('Ask a question via the cloud sandbox')
	.requiredOption('-q, --question <text>', 'Question to ask')
	.option('-r, --resource <name...>', 'Resources to query')
	.action(async (options: { question: string; resource?: string[] }) => {
		const result = await Result.tryPromise(async () => {
			const client = await requireAuth();
			const config = await loadConfig();

			// Get available resources
			const resourcesResult = await client.listResources(config?.project);
			if (!resourcesResult.ok) {
				console.error(red(`Error: ${resourcesResult.error}`));
				process.exit(1);
			}

			const available = resourcesResult.resources;
			if (available.length === 0) {
				console.error(red('No resources available.'));
				console.error('Add resources first with `btca remote add`.');
				process.exit(1);
			}

			// Determine which resources to use
			let resources: string[];
			if (options.resource && options.resource.length > 0) {
				// Validate requested resources
				const invalid = options.resource.filter(
					(r) => !available.some((a) => a.name.toLowerCase() === r.toLowerCase())
				);
				if (invalid.length > 0) {
					console.error(red(`Invalid resources: ${invalid.join(', ')}`));
					console.error(`Available: ${available.map((a) => a.name).join(', ')}`);
					process.exit(1);
				}
				resources = options.resource;
			} else {
				// Use all available resources
				resources = available.map((a) => a.name);
			}

			console.log('Asking...\n');

			const result = await client.ask(options.question, resources, config?.project);

			if (!result.ok) {
				console.error(red(`Error: ${result.error}`));
				process.exit(1);
			}

			console.log(result.text);
			console.log('');
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});

/**
 * btca remote grab - Output thread transcript
 */
const grabCommand = new Command('grab')
	.description('Output the full transcript of a thread')
	.argument('<threadId>', 'Thread ID to fetch')
	.option('--json', 'Output as JSON')
	.option('--markdown', 'Output as markdown (default)')
	.action(async (threadId: string, options: { json?: boolean; markdown?: boolean }) => {
		const result = await Result.tryPromise(async () => {
			const client = await requireAuth();

			const result = await client.getThread(threadId);

			if (!result.ok) {
				console.error(red(`Error: ${result.error}`));
				process.exit(1);
			}

			const { thread, messages } = result;

			if (options.json) {
				console.log(JSON.stringify({ thread, messages }, null, 2));
				return;
			}

			// Markdown output (default)
			console.log(`# ${thread.title ?? 'Untitled Thread'}\n`);
			console.log(`Thread ID: ${thread._id}`);
			console.log(`Created: ${new Date(thread.createdAt).toISOString()}\n`);
			console.log('---\n');

			for (const msg of messages) {
				const roleLabel =
					msg.role === 'user'
						? '**User**'
						: msg.role === 'assistant'
							? '**Assistant**'
							: '**System**';
				console.log(`${roleLabel}:\n`);
				console.log(msg.content);
				console.log('\n---\n');
			}
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});

/**
 * btca remote init - Initialize a remote config file
 */
const initCommand = new Command('init')
	.description('Initialize a remote config file in the current directory')
	.option('-p, --project <name>', 'Project name')
	.action(async (options: { project?: string }) => {
		const result = await Result.tryPromise(async () => {
			const existingConfig = await loadConfig();
			if (existingConfig) {
				console.error(red(`Remote config already exists (${REMOTE_CONFIG_FILENAME}).`));
				process.exit(1);
			}

			let projectName = options.project;

			if (!projectName) {
				const rl = createRl();
				projectName = await promptInput(rl, 'Project name', 'default');
				rl.close();
			}

			if (!projectName) {
				console.error(red('Project name is required.'));
				process.exit(1);
			}

			const config: RemoteConfig = {
				project: projectName,
				model: 'claude-haiku',
				resources: []
			};

			await saveConfig(config);

			console.log(green(`Created ${REMOTE_CONFIG_FILENAME}`));
			console.log(`\nNext steps:`);
			console.log(`  1. ${dim('btca remote link')}       - Authenticate (if not already)`);
			console.log(`  2. ${dim('btca remote add <url>')}  - Add resources`);
			console.log(`  3. ${dim('btca remote sync')}       - Sync to cloud`);
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});

// ─────────────────────────────────────────────────────────────────────────────
// MCP Config Templates
// ─────────────────────────────────────────────────────────────────────────────

type McpAgent = 'opencode' | 'claude';

const MCP_API_KEY_URL = 'https://btca.dev/app/settings?tab=mcp';

function getMcpConfig(agent: McpAgent, apiKey: string): object | string {
	const mcpUrl = 'https://btca.dev/api/mcp';

	switch (agent) {
		case 'opencode':
			return {
				$schema: 'https://opencode.ai/config.json',
				mcp: {
					'better-context': {
						type: 'remote',
						url: mcpUrl,
						enabled: true,
						headers: {
							Authorization: `Bearer ${apiKey}`
						}
					}
				}
			};
		case 'claude':
			// Return shell command string for Claude Code
			return `claude mcp add --transport http better-context ${mcpUrl} \\
  --header "Authorization: Bearer ${apiKey}"`;
	}
}

function getMcpInstructions(agent: McpAgent): string {
	switch (agent) {
		case 'opencode':
			return `Add this to your ${bold('opencode.json')} file:`;
		case 'claude':
			return `Run this command to add the MCP server:`;
	}
}

/**
 * btca remote mcp - Output MCP configuration for various agents
 */
const mcpCommand = new Command('mcp')
	.description('Output MCP configuration for your AI agent')
	.argument('[agent]', 'Agent type: opencode or claude')
	.action(async (agent?: string) => {
		const result = await Result.tryPromise(async () => {
			const auth = await loadAuth();
			if (!auth) {
				console.error(red('Not authenticated with remote.'));
				console.error(`\nGet your API key from: ${bold(MCP_API_KEY_URL)}`);
				console.error(`Then run ${bold('btca remote link')} to authenticate.`);
				process.exit(1);
			}

			let selectedAgent: McpAgent;

			if (agent) {
				const normalized = agent.toLowerCase();
				if (normalized !== 'opencode' && normalized !== 'claude') {
					console.error(red(`Invalid agent: ${agent}`));
					console.error('Valid options: opencode, claude');
					process.exit(1);
				}
				selectedAgent = normalized as McpAgent;
			} else {
				// Prompt user to select agent
				console.log('\nSelect your AI agent:\n');
				console.log('  1) OpenCode');
				console.log('  2) Claude Code');
				console.log('');

				const rl = createRl();
				const answer = await new Promise<string>((resolve) => {
					rl.question('Enter number: ', (ans) => {
						rl.close();
						resolve(ans.trim());
					});
				});

				const num = parseInt(answer, 10);
				if (num === 1) {
					selectedAgent = 'opencode';
				} else if (num === 2) {
					selectedAgent = 'claude';
				} else {
					console.error(red('Invalid selection.'));
					process.exit(1);
				}
			}

			const config = getMcpConfig(selectedAgent, auth.apiKey);
			const instructions = getMcpInstructions(selectedAgent);

			console.log(`\n${instructions}\n`);
			if (typeof config === 'string') {
				// Claude Code outputs a shell command
				console.log(config);
			} else {
				console.log(JSON.stringify(config, null, 2));
			}
			console.log('');
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
			process.exit(1);
		}
	});

// ─────────────────────────────────────────────────────────────────────────────
// Main Remote Command
// ─────────────────────────────────────────────────────────────────────────────

export const remoteCommand = new Command('remote')
	.description('Manage btca cloud service (remote mode)')
	.addCommand(linkCommand)
	.addCommand(unlinkCommand)
	.addCommand(statusCommand)
	.addCommand(wakeCommand)
	.addCommand(addCommand)
	.addCommand(syncCommand)
	.addCommand(askCommand)
	.addCommand(grabCommand)
	.addCommand(initCommand)
	.addCommand(mcpCommand);
