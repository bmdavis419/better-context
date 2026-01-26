import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as readline from 'readline';

const PROJECT_CONFIG_FILENAME = 'btca.config.jsonc';
const CONFIG_SCHEMA_URL = 'https://btca.schema.json';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_PROVIDER = 'opencode';
const MCP_DASHBOARD_URL = 'https://btca.dev/app/settings/mcp/';

// AGENTS.md section templates
const MCP_AGENTS_SECTION = `## Better Context MCP

Use Better Context MCP for documentation/resource questions when you need source-first answers.

**Required workflow**
1. Call \`listResources\` first to see available resources.
2. Call \`ask\` with your question and the exact resource \`name\` values from step 1.

**Rules**
- Always call \`listResources\` before \`ask\`.
- \`ask\` requires at least one resource in the \`resources\` array.
- Use only resource names returned by \`listResources\`.
- Include only resources relevant to the question.

**Common errors**
- "Invalid resources" → re-run \`listResources\` and use exact names.
- "Instance is provisioning / error state" → wait or retry after a minute.
- "Missing or invalid Authorization header" → MCP auth is invalid; fix it in \`https://btca.dev/app/settings/mcp/\`.
`;

const CLI_AGENTS_SECTION = `## btca

When you need up-to-date information about technologies used in this project, use btca to query source repositories directly.

**Available resources**: (run \`btca config resources list\` to see configured resources)

### Usage

Ask a question about one or more resources:

\`\`\`bash
btca ask --resource <resource> --question "<question>"
\`\`\`

Examples:

\`\`\`bash
# Single resource
btca ask --resource svelte --question "How do stores work in Svelte 5?"

# Multiple resources
btca ask --resource svelte --resource effect --question "How do I integrate Effect with Svelte?"

# Using @mentions in the question
btca ask --question "@svelte @tailwind How do I style components?"
\`\`\`

### Interactive Mode

Start a chat session for deeper exploration:

\`\`\`bash
btca chat --resource svelte --resource effect
\`\`\`

Or use the TUI:

\`\`\`bash
btca
\`\`\`

Then use \`@mentions\` to reference resources (e.g., "@svelte How do I create a store?")

### Configuration

This project's btca resources are configured in \`btca.config.jsonc\` at the project root. To modify:

- Edit the config file directly, or
- Use \`btca config resources add/remove\` commands
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
 * Check if a pattern is already in .gitignore (handles variations like .btca, .btca/, .btca/*).
 */
async function isPatternInGitignore(dir: string, pattern: string): Promise<boolean> {
	try {
		const gitignorePath = path.join(dir, '.gitignore');
		const content = await fs.readFile(gitignorePath, 'utf-8');
		const lines = content.split('\n').map((line) => line.trim());

		// Check for the pattern and common variations
		const basePattern = pattern.replace(/\/$/, ''); // Remove trailing slash
		const patterns = [basePattern, `${basePattern}/`, `${basePattern}/*`];

		return lines.some((line) => {
			// Skip comments and empty lines
			if (line.startsWith('#') || line === '') return false;
			return patterns.includes(line);
		});
	} catch {
		return false;
	}
}

/**
 * Add a pattern to .gitignore, creating the file if it doesn't exist.
 */
async function addToGitignore(dir: string, pattern: string, comment?: string): Promise<void> {
	const gitignorePath = path.join(dir, '.gitignore');
	let content = '';

	try {
		content = await fs.readFile(gitignorePath, 'utf-8');
		// Ensure file ends with newline
		if (!content.endsWith('\n')) {
			content += '\n';
		}
	} catch {
		// File doesn't exist, start fresh
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
	try {
		await fs.access(path.join(dir, '.git'));
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Update or create AGENTS.md with the appropriate section.
 */
async function updateAgentsMd(dir: string, section: string): Promise<void> {
	const agentsPath = path.join(dir, 'AGENTS.md');

	try {
		let content = await fs.readFile(agentsPath, 'utf-8');

		// Check if already has a btca/Better Context section
		const btcaRegex = /## btca[\s\S]*?(?=\n## |\n# |$)/;
		const mcpRegex = /## Better Context MCP[\s\S]*?(?=\n## |\n# |$)/;
		const betterContextRegex = /## Better Context[\s\S]*?(?=\n## |\n# |$)/;

		if (btcaRegex.test(content)) {
			content = content.replace(btcaRegex, section.trim());
		} else if (mcpRegex.test(content)) {
			content = content.replace(mcpRegex, section.trim());
		} else if (betterContextRegex.test(content)) {
			content = content.replace(betterContextRegex, section.trim());
		} else {
			// Append to end
			if (!content.endsWith('\n')) {
				content += '\n';
			}
			content += '\n' + section;
		}

		await fs.writeFile(agentsPath, content, 'utf-8');
	} catch {
		// File doesn't exist, create it
		await fs.writeFile(agentsPath, `# AGENTS.md\n\n${section}`, 'utf-8');
	}
}

export const initCommand = new Command('init')
	.description('Initialize btca for this project')
	.option('-f, --force', 'Overwrite existing configuration')
	.action(async (options: { force?: boolean }) => {
		const cwd = process.cwd();
		const configPath = path.join(cwd, PROJECT_CONFIG_FILENAME);

		try {
			// Step 1: Ask for setup type
			const setupType = await promptSelect<SetupType>('Choose setup type:', [
				{ label: 'MCP (cloud hosted resources)', value: 'mcp' },
				{ label: 'CLI (local resources)', value: 'cli' }
			]);

			if (setupType === 'mcp') {
				// MCP Path
				await handleMcpSetup(cwd);
			} else {
				// CLI Path
				await handleCliSetup(cwd, configPath, options.force);
			}
		} catch (error) {
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
async function handleMcpSetup(cwd: string): Promise<void> {
	// Update AGENTS.md with MCP section
	await updateAgentsMd(cwd, MCP_AGENTS_SECTION);
	console.log('\nUpdated AGENTS.md with Better Context MCP instructions.');

	// Print next steps
	console.log('\n--- Setup Complete (MCP) ---\n');
	console.log('Next steps:');
	console.log(`  1. Get your MCP API key from the dashboard: ${MCP_DASHBOARD_URL}`);
	console.log('  2. Configure your MCP client with the Better Context endpoint.');
	console.log('\nSee the dashboard for detailed setup instructions.');
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

	// Update AGENTS.md with CLI section
	await updateAgentsMd(cwd, CLI_AGENTS_SECTION);
	console.log('Updated AGENTS.md with btca CLI instructions.');

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
	console.log('     Or: btca config resources add -n <name> -t git -u <url>');
	console.log('  2. Ask a question: btca ask -r <resource> -q "your question"');
	console.log("\nRun 'btca --help' for more options.");
}
