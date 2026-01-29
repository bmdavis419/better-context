import { Result } from 'better-result';
import { Command } from 'commander';
import * as readline from 'readline';
import path from 'node:path';
import { ensureServer } from '../server/manager.ts';
import { addResource, BtcaError } from '../client/index.ts';
import { dim } from '../lib/utils/colors.ts';

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

/**
 * Prompt for single selection from a list.
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
 * Interactive wizard for adding a git resource.
 */
async function addGitResourceWizard(
	url: string,
	options: { global?: boolean },
	globalOpts: { server?: string; port?: number } | undefined
): Promise<void> {
	const urlParts = parseGitHubUrl(url);
	if (!urlParts) {
		console.error('Error: Invalid GitHub URL.');
		console.error('Expected format: https://github.com/owner/repo');
		process.exit(1);
	}

	const normalizedUrl = normalizeGitHubUrl(url);

	console.log('\n--- Add Git Resource ---\n');
	console.log(`Repository: ${normalizedUrl}`);

	const rl = createRl();

	const result = await Result.tryPromise(async () => {
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
	});

	rl.close();

	if (Result.isError(result)) {
		throw result.error;
	}
}

/**
 * Interactive wizard for adding a local resource.
 */
async function addLocalResourceWizard(
	localPath: string,
	options: { global?: boolean },
	globalOpts: { server?: string; port?: number } | undefined
): Promise<void> {
	// Resolve the path
	const resolvedPath = path.isAbsolute(localPath)
		? localPath
		: path.resolve(process.cwd(), localPath);

	console.log('\n--- Add Local Resource ---\n');
	console.log(`Directory: ${resolvedPath}`);

	const rl = createRl();

	const result = await Result.tryPromise(async () => {
		// Step 1: Path (prefilled, confirm)
		const finalPath = await promptInput(rl, 'Path', resolvedPath);

		// Step 2: Name (default = directory name)
		const defaultName = path.basename(finalPath);
		const name = await promptInput(rl, 'Name', defaultName);

		// Step 3: Notes (optional)
		const notes = await promptInput(rl, 'Notes (optional)');

		rl.close();

		// Summary
		console.log('\n--- Summary ---\n');
		console.log(`  Type:    local`);
		console.log(`  Name:    ${name}`);
		console.log(`  Path:    ${finalPath}`);
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

		await addResource(server.url, {
			type: 'local',
			name,
			path: finalPath,
			...(notes && { specialNotes: notes })
		});

		server.stop();

		console.log(`\nAdded resource: ${name}`);
		console.log('\nYou can now use this resource:');
		console.log(`  btca ask -r ${name} -q "your question"`);
	});

	rl.close();

	if (Result.isError(result)) {
		throw result.error;
	}
}

export const addCommand = new Command('add')
	.description('Add a resource (git repository or local directory)')
	.argument('[url-or-path]', 'GitHub repository URL or local directory path')
	.option('-g, --global', 'Add to global config instead of project config')
	.option('-n, --name <name>', 'Resource name')
	.option('-b, --branch <branch>', 'Git branch (default: main)')
	.option('-s, --search-path <path...>', 'Search paths within repo (can specify multiple)')
	.option('--notes <notes>', 'Special notes for the agent')
	.option('-t, --type <type>', 'Resource type: git or local (auto-detected if not specified)')
	.action(
		async (
			urlOrPath: string | undefined,
			options: {
				global?: boolean;
				name?: string;
				branch?: string;
				searchPath?: string[];
				notes?: string;
				type?: string;
			},
			command
		) => {
			const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;

			const result = await Result.tryPromise(async () => {
				// If no argument provided, start interactive wizard
				if (!urlOrPath) {
					const resourceType = await promptSelect<'git' | 'local'>(
						'What type of resource do you want to add?',
						[
							{ label: 'Git repository', value: 'git' },
							{ label: 'Local directory', value: 'local' }
						]
					);

					const rl = createRl();
					if (resourceType === 'git') {
						const url = await promptInput(rl, 'GitHub URL');
						rl.close();
						if (!url) {
							console.error('Error: URL is required.');
							process.exit(1);
						}
						await addGitResourceWizard(url, options, globalOpts);
					} else {
						const localPath = await promptInput(rl, 'Local path');
						rl.close();
						if (!localPath) {
							console.error('Error: Path is required.');
							process.exit(1);
						}
						await addLocalResourceWizard(localPath, options, globalOpts);
					}
					return;
				}

				// Determine type from argument or explicit flag
				let resourceType: 'git' | 'local' = 'git';

				if (options.type) {
					if (options.type !== 'git' && options.type !== 'local') {
						console.error('Error: --type must be "git" or "local"');
						process.exit(1);
					}
					resourceType = options.type as 'git' | 'local';
				} else {
					// Auto-detect: if it looks like a URL, it's git; otherwise local
					const isUrl =
						urlOrPath.startsWith('http://') ||
						urlOrPath.startsWith('https://') ||
						urlOrPath.startsWith('github.com/') ||
						urlOrPath.includes('github.com/');
					resourceType = isUrl ? 'git' : 'local';
				}

				// If all required options provided via flags, skip wizard
				if (options.name && resourceType === 'git' && parseGitHubUrl(urlOrPath)) {
					// Non-interactive git add
					const normalizedUrl = normalizeGitHubUrl(urlOrPath);
					const server = await ensureServer({
						serverUrl: globalOpts?.server,
						port: globalOpts?.port,
						quiet: true
					});

					const searchPaths = options.searchPath ?? [];
					const resource = await addResource(server.url, {
						type: 'git',
						name: options.name,
						url: normalizedUrl,
						branch: options.branch ?? 'main',
						...(searchPaths.length === 1 && { searchPath: searchPaths[0] }),
						...(searchPaths.length > 1 && { searchPaths }),
						...(options.notes && { specialNotes: options.notes })
					});

					server.stop();

					console.log(`Added git resource: ${options.name}`);
					if (resource.type === 'git' && resource.url !== normalizedUrl) {
						console.log(`  URL normalized: ${resource.url}`);
					}
					return;
				}

				if (options.name && resourceType === 'local') {
					// Non-interactive local add
					const resolvedPath = path.isAbsolute(urlOrPath)
						? urlOrPath
						: path.resolve(process.cwd(), urlOrPath);
					const server = await ensureServer({
						serverUrl: globalOpts?.server,
						port: globalOpts?.port,
						quiet: true
					});

					await addResource(server.url, {
						type: 'local',
						name: options.name,
						path: resolvedPath,
						...(options.notes && { specialNotes: options.notes })
					});

					server.stop();
					console.log(`Added local resource: ${options.name}`);
					return;
				}

				// Interactive wizard based on type
				if (resourceType === 'git') {
					await addGitResourceWizard(urlOrPath, options, globalOpts);
				} else {
					await addLocalResourceWizard(urlOrPath, options, globalOpts);
				}
			});

			if (Result.isError(result)) {
				const error = result.error;
				if (error instanceof Error && error.message === 'Invalid selection') {
					console.error('\nError: Invalid selection. Please try again.');
					process.exit(1);
				}
				console.error(formatError(error));
				process.exit(1);
			}
		}
	);
