import { Command } from 'commander';
import * as readline from 'readline';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { ensureServer } from '../server/manager.ts';
import { addResource, BtcaError } from '../client/index.ts';
import { dim } from '../lib/utils/colors.ts';

const PROJECT_CONFIG_FILENAME = 'btca.config.jsonc';
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), '.config', 'btca');
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, PROJECT_CONFIG_FILENAME);

interface GitHubUrlParts {
	owner: string;
	repo: string;
}

/**
 * Parse a GitHub URL and extract owner/repo.
 */
function parseGitHubUrl(url: string): GitHubUrlParts | null {
	// Handle various GitHub URL formats:
	// - https://github.com/owner/repo
	// - https://github.com/owner/repo.git
	// - github.com/owner/repo
	const patterns = [
		/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(\.git)?$/,
		/^github\.com\/([^/]+)\/([^/]+?)(\.git)?$/
	];

	for (const pattern of patterns) {
		const match = url.match(pattern);
		if (match) {
			return {
				owner: match[1]!,
				repo: match[2]!
			};
		}
	}

	return null;
}

/**
 * Normalize GitHub URL to standard format.
 */
function normalizeGitHubUrl(url: string): string {
	const parts = parseGitHubUrl(url);
	if (!parts) return url;
	return `https://github.com/${parts.owner}/${parts.repo}`;
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
 * Get the config path based on -g flag.
 */
function getConfigPath(global: boolean): string {
	if (global) {
		return GLOBAL_CONFIG_PATH;
	}
	return path.join(process.cwd(), PROJECT_CONFIG_FILENAME);
}

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

/**
 * Create a readline interface for prompts.
 */
function createRl(): readline.Interface {
	return readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
}

/**
 * Prompt for input with a default value.
 */
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

/**
 * Prompt for confirmation (y/n).
 */
async function promptConfirm(rl: readline.Interface, question: string): Promise<boolean> {
	return new Promise((resolve) => {
		rl.question(`${question} ${dim('(y/n)')}: `, (answer) => {
			resolve(answer.trim().toLowerCase() === 'y');
		});
	});
}

/**
 * Prompt for repeated entries (search paths).
 */
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

export const addCommand = new Command('add')
	.description('Add a GitHub repository as a resource')
	.argument('<url>', 'GitHub repository URL (e.g., https://github.com/owner/repo)')
	.option('-g, --global', 'Add to global config instead of project config')
	.action(async (url: string, options: { global?: boolean }, command) => {
		const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;
		const configPath = getConfigPath(options.global ?? false);

		try {
			// Validate GitHub URL
			const urlParts = parseGitHubUrl(url);
			if (!urlParts) {
				console.error('Error: Invalid GitHub URL.');
				console.error('Expected format: https://github.com/owner/repo');
				process.exit(1);
			}

			// Check if config exists
			if (!(await fileExists(configPath))) {
				if (options.global) {
					console.error(`Error: Global config not found at ${GLOBAL_CONFIG_PATH}`);
					console.error('Run "btca init" first to create a configuration.');
				} else {
					console.error(`Error: No ${PROJECT_CONFIG_FILENAME} found in current directory.`);
					console.error('Run "btca init" first to create a project configuration.');
				}
				process.exit(1);
			}

			const normalizedUrl = normalizeGitHubUrl(url);

			// Start the interactive wizard
			console.log('\n--- Add Resource Wizard ---\n');
			console.log(`Repository: ${normalizedUrl}`);

			const rl = createRl();

			try {
				// Step 1: URL (prefilled, confirm)
				const finalUrl = await promptInput(rl, 'URL', normalizedUrl);

				// Step 2: Name (default = repo name)
				const defaultName = urlParts.repo;
				const name = await promptInput(rl, 'Name', defaultName);

				// Step 3: Branch (default = main)
				const branch = await promptInput(rl, 'Branch', 'main');

				// Step 4: Search paths (optional, repeated)
				const wantSearchPaths = await promptConfirm(
					rl,
					'Do you want to add search paths (subdirectories to focus on)?'
				);
				const searchPaths = wantSearchPaths ? await promptRepeated(rl, 'Search path') : [];

				// Step 5: Notes (optional)
				const notes = await promptInput(rl, 'Notes (optional)');

				rl.close();

				// Summary
				console.log('\n--- Summary ---\n');
				console.log(`  Name:    ${name}`);
				console.log(`  URL:     ${finalUrl}`);
				console.log(`  Branch:  ${branch}`);
				if (searchPaths.length > 0) {
					console.log(`  Search:  ${searchPaths.join(', ')}`);
				}
				if (notes) {
					console.log(`  Notes:   ${notes}`);
				}
				console.log(`  Config:  ${options.global ? 'global' : 'project'}`);
				console.log('');

				// Confirm
				const confirmRl = createRl();
				const confirmed = await promptConfirm(confirmRl, 'Add this resource?');
				confirmRl.close();

				if (!confirmed) {
					console.log('\nCancelled.');
					process.exit(0);
				}

				// Add the resource via server
				const server = await ensureServer({
					serverUrl: globalOpts?.server,
					port: globalOpts?.port,
					quiet: true
				});

				const resource = await addResource(server.url, {
					type: 'git',
					name,
					url: finalUrl,
					branch,
					...(searchPaths.length === 1 && { searchPath: searchPaths[0] }),
					...(searchPaths.length > 1 && { searchPaths }),
					...(notes && { specialNotes: notes })
				});

				server.stop();

				console.log(`\nAdded resource: ${name}`);
				if (resource.type === 'git' && resource.url !== finalUrl) {
					console.log(`  URL normalized: ${resource.url}`);
				}
				console.log('\nYou can now use this resource:');
				console.log(`  btca ask -r ${name} -q "your question"`);
			} catch (error) {
				rl.close();
				throw error;
			}
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});
