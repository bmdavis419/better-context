import { Result } from 'better-result';
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as readline from 'readline';
import { loadAuth, saveAuth } from '../lib/auth.ts';
import { RemoteClient } from '../client/remote.ts';

const PROJECT_CONFIG_FILENAME = 'btca.config.jsonc';
const REMOTE_CONFIG_FILENAME = 'btca.remote.config.jsonc';
const CONFIG_SCHEMA_URL = 'https://btca.dev/btca.schema.json';
const REMOTE_CONFIG_SCHEMA_URL = 'https://btca.dev/btca.remote.schema.json';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_PROVIDER = 'opencode';
const MCP_API_KEY_URL = 'https://btca.dev/app/settings?tab=mcp';

// ─────────────────────────────────────────────────────────────────────────────
// Skill Templates
// ─────────────────────────────────────────────────────────────────────────────

const BTCA_REMOTE_SKILL_CONTENT = `---
name: btca-remote
description: Query cloud-hosted btca resources via MCP for source-first answers
---

## What I do

- Query btca's cloud-hosted resources through MCP
- Provide source-first answers about technologies
- Access resources provisioned in the btca dashboard

## When to use me

Use this skill when you need up-to-date information about technologies configured in the project's btca cloud instance.

## Getting resources

Check \`btca.remote.config.jsonc\` for the list of available resources in this project.

## Workflow

1. Call \`listResources\` to see available resources
2. Call \`ask\` with your question and exact resource names from step 1

## Rules

- Always call \`listResources\` before \`ask\`
- \`ask\` requires at least one resource in the \`resources\` array
- Use only resource names returned by \`listResources\`
- Include only resources relevant to the question

## Common errors

- "Invalid resources" -> re-run \`listResources\` and use exact names
- "Instance is provisioning / error state" -> wait or retry after a minute
- "Missing or invalid Authorization header" -> MCP auth is invalid; fix it in https://btca.dev/app/settings/
- MCP server doesn't exist -> Prompt the user to set it up at https://btca.dev/app/settings/
`;

const BTCA_LOCAL_SKILL_CONTENT = `---
name: btca-local
description: Query local btca resources via CLI for source-first answers
---

## What I do

- Query locally-cloned resources using the btca CLI
- Provide source-first answers about technologies stored in .btca/ or ~/.local/share/btca/

## When to use me

Use this skill when you need information about technologies stored in the project's local btca resources.

## Getting resources

Check \`btca.config.jsonc\` for the list of available resources in this project.

## Commands

Ask a question about one or more resources:

\`\`\`bash
# Single resource
btca ask --resource <resource> --question "<question>"

# Multiple resources
btca ask --resource svelte --resource effect --question "How do I integrate Effect with Svelte?"

# Using @mentions in the question
btca ask --question "@svelte @tailwind How do I style components?"
\`\`\`

## Managing Resources

\`\`\`bash
# Add a git resource
btca add https://github.com/owner/repo

# Add a local directory
btca add ./docs

# Remove a resource
btca remove <name>
\`\`\`
`;

type SetupType = 'mcp' | 'cli';
type StorageType = 'local' | 'global';

/**
 * Prompt user for single selection.
 */
async function promptSelect<T extends string>(
	question: string,
	options: { label: string; value: T }[]
): Promise<T> {
	return new Promise((resolve, reject) => {
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

/**
 * Prompt user for input with optional default value.
 */
async function promptInput(question: string, defaultValue?: string): Promise<string> {
	return new Promise((resolve) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});

		const defaultHint = defaultValue ? ` (${defaultValue})` : '';
		rl.question(`${question}${defaultHint}: `, (answer) => {
			rl.close();
			resolve(answer.trim() || defaultValue || '');
		});
	});
}

/**
 * Check if a pattern is already in .gitignore (handles variations like .btca, .btca/, .btca/*).
 */
async function isPatternInGitignore(dir: string, pattern: string): Promise<boolean> {
	const gitignorePath = path.join(dir, '.gitignore');
	const result = await Result.tryPromise(() => fs.readFile(gitignorePath, 'utf-8'));
	if (Result.isError(result)) return false;
	const lines = result.value.split('\n').map((line) => line.trim());

	// Check for the pattern and common variations
	const basePattern = pattern.replace(/\/$/, '');
	const patterns = [basePattern, `${basePattern}/`, `${basePattern}/*`];

	return lines.some((line) => {
		// Skip comments and empty lines
		if (line.startsWith('#') || line === '') return false;
		return patterns.includes(line);
	});
}

/**
 * Add a pattern to .gitignore, creating the file if it doesn't exist.
 */
async function addToGitignore(dir: string, pattern: string, comment?: string): Promise<void> {
	const gitignorePath = path.join(dir, '.gitignore');
	const contentResult = await Result.tryPromise(() => fs.readFile(gitignorePath, 'utf-8'));
	let content = Result.isOk(contentResult) ? contentResult.value : '';
	if (content && !content.endsWith('\n')) {
		content += '\n';
	}

	// Add comment and pattern
	if (comment) {
		content += `\n${comment}\n`;
	}
	content += `${pattern}\n`;

	await fs.writeFile(gitignorePath, content, 'utf-8');
}

/**
 * Check if directory is a git repository.
 */
async function isGitRepo(dir: string): Promise<boolean> {
	const result = await Result.tryPromise(() => fs.access(path.join(dir, '.git')));
	return Result.isOk(result);
}

/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
	const result = await Result.tryPromise(() => fs.access(filePath));
	return Result.isOk(result);
}

/**
 * Create a skill file in .claude/skills/<skillName>/SKILL.md
 */
async function createSkillFile(cwd: string, skillName: string, content: string): Promise<void> {
	const skillDir = path.join(cwd, '.claude', 'skills', skillName);
	const skillPath = path.join(skillDir, 'SKILL.md');

	await fs.mkdir(skillDir, { recursive: true });
	await fs.writeFile(skillPath, content, 'utf-8');
}

/**
 * Sanitize a string to be used as a project name.
 */
function sanitizeProjectName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

export const initCommand = new Command('init')
	.description('Initialize btca for this project')
	.option('-f, --force', 'Overwrite existing configuration')
	.action(async (options: { force?: boolean }) => {
		const cwd = process.cwd();
		const configPath = path.join(cwd, PROJECT_CONFIG_FILENAME);

		const result = await Result.tryPromise(async () => {
			// Step 1: Ask for setup type
			const setupType = await promptSelect<SetupType>('Choose setup type:', [
				{ label: 'MCP (cloud hosted resources)', value: 'mcp' },
				{ label: 'CLI (local resources)', value: 'cli' }
			]);

			if (setupType === 'mcp') {
				// MCP Path
				await handleMcpSetup(cwd, options.force);
			} else {
				// CLI Path
				await handleCliSetup(cwd, configPath, options.force);
			}
		});

		if (Result.isError(result)) {
			const error = result.error;
			if (error instanceof Error && error.message === 'Invalid selection') {
				console.error('\nError: Invalid selection. Please run btca init again.');
				process.exit(1);
			}
			console.error('Error:', error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	});

/**
 * Handle MCP setup path.
 */
async function handleMcpSetup(cwd: string, force?: boolean): Promise<void> {
	const configPath = path.join(cwd, REMOTE_CONFIG_FILENAME);

	// Check for existing config
	if ((await fileExists(configPath)) && !force) {
		console.error(`\nError: ${REMOTE_CONFIG_FILENAME} already exists.`);
		console.error('Use --force to overwrite.');
		process.exit(1);
	}

	// Step 1: Check/handle authentication
	let auth = await loadAuth();

	if (!auth) {
		console.log('\nNo API key found. Please get one from:');
		console.log(`  ${MCP_API_KEY_URL}\n`);

		const apiKey = await promptInput('API Key');

		if (!apiKey) {
			console.error('API key is required.');
			process.exit(1);
		}

		// Validate the API key
		console.log('Validating API key...');
		const client = new RemoteClient({ apiKey });
		const validation = await client.validate();

		if (!validation.valid) {
			console.error(`Invalid API key: ${validation.error}`);
			process.exit(1);
		}

		// Save auth
		auth = { apiKey, linkedAt: Date.now() };
		await saveAuth(auth);
		console.log('API key saved.\n');
	} else {
		console.log('\nUsing existing API key.\n');
	}

	// Step 2: Get project name
	const defaultProjectName = sanitizeProjectName(path.basename(cwd));
	const projectName = await promptInput(`Project name`, defaultProjectName);

	if (!projectName) {
		console.error('Project name is required.');
		process.exit(1);
	}

	// Step 3: Create btca.remote.config.jsonc
	const config = {
		$schema: REMOTE_CONFIG_SCHEMA_URL,
		project: projectName,
		model: 'claude-haiku',
		resources: [] as unknown[]
	};

	await fs.writeFile(configPath, JSON.stringify(config, null, '\t'), 'utf-8');
	console.log(`Created ${REMOTE_CONFIG_FILENAME}`);

	// Step 4: Create skill file
	await createSkillFile(cwd, 'btca-remote', BTCA_REMOTE_SKILL_CONTENT);
	console.log('Created .claude/skills/btca-remote/SKILL.md');

	// Step 5: Print next steps
	console.log('\n--- Setup Complete (MCP) ---\n');
	console.log('Next steps:');
	console.log('  1. Add resources: btca remote add https://github.com/owner/repo');
	console.log('  2. Or add via dashboard: https://btca.dev/app/resources');
	console.log('  3. Query resources: btca remote ask -q "your question"');
}

/**
 * Handle CLI setup path.
 */
async function handleCliSetup(cwd: string, configPath: string, force?: boolean): Promise<void> {
	// Check if config already exists
	if (await fileExists(configPath)) {
		if (!force) {
			console.error(`\nError: ${PROJECT_CONFIG_FILENAME} already exists.`);
			console.error('Use --force to overwrite.');
			process.exit(1);
		}
		console.log(`\nOverwriting existing ${PROJECT_CONFIG_FILENAME}...`);
	}

	// Ask for storage type
	const storageType = await promptSelect<StorageType>('Where should btca store cloned resources?', [
		{ label: 'Local (.btca/ in this project)', value: 'local' },
		{ label: 'Global (~/.local/share/btca/)', value: 'global' }
	]);

	// Build the config
	const config: Record<string, unknown> = {
		$schema: CONFIG_SCHEMA_URL,
		model: DEFAULT_MODEL,
		provider: DEFAULT_PROVIDER,
		resources: []
	};

	// Add dataDirectory if local storage chosen
	if (storageType === 'local') {
		config.dataDirectory = '.btca';
	}

	// Write config file
	const configContent = JSON.stringify(config, null, '\t');
	await fs.writeFile(configPath, configContent, 'utf-8');
	console.log(`\nCreated ${PROJECT_CONFIG_FILENAME}`);

	// Handle .gitignore if using local data directory
	if (storageType === 'local') {
		const inGitRepo = await isGitRepo(cwd);

		if (inGitRepo) {
			const alreadyIgnored = await isPatternInGitignore(cwd, '.btca');

			if (!alreadyIgnored) {
				await addToGitignore(cwd, '.btca/', '# btca local data');
				console.log('Added .btca/ to .gitignore');
			} else {
				console.log('.btca/ already in .gitignore');
			}
		} else {
			console.log("\nWarning: This directory doesn't appear to be a git repository.");
			console.log('The .btca/ folder will be created but .gitignore was not updated.');
			console.log("If you initialize git later, add '.btca/' to your .gitignore.");
		}
	}

	// Create skill file
	await createSkillFile(cwd, 'btca-local', BTCA_LOCAL_SKILL_CONTENT);
	console.log('Created .claude/skills/btca-local/SKILL.md');

	// Print summary
	if (storageType === 'local') {
		console.log('\nData directory: .btca/ (local to this project)');
	} else {
		console.log('\nData directory: ~/.local/share/btca/ (global)');
	}

	// Print next steps
	console.log('\n--- Setup Complete (CLI) ---\n');
	console.log('Next steps:');
	console.log('  1. Add resources: btca add https://github.com/owner/repo');
	console.log('  2. Ask a question: btca ask -r <resource> -q "your question"');
	console.log('  3. Or launch the TUI: btca');
	console.log("\nRun 'btca --help' for more options.");
}
