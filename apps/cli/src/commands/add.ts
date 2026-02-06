import { Result } from 'better-result';
import { Command } from 'commander';
import path from 'node:path';
import * as readline from 'readline';

import { addResource, BtcaError } from '../client/index.ts';
import { dim } from '../lib/utils/colors.ts';
import { ensureServer } from '../server/manager.ts';

interface GitHubUrlParts {
	owner: string;
	repo: string;
}

type ResourceType = 'git' | 'local' | 'website';

const DEFAULT_WEBSITE_MAX_PAGES = 200;
const DEFAULT_WEBSITE_MAX_DEPTH = 3;
const DEFAULT_WEBSITE_TTL_HOURS = 24;

const parseGitHubUrl = (url: string): GitHubUrlParts | null => {
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
};

const normalizeGitHubUrl = (url: string) => {
	const parts = parseGitHubUrl(url);
	if (!parts) return url;
	return `https://github.com/${parts.owner}/${parts.repo}`;
};

const formatError = (error: unknown): string => {
	if (error instanceof BtcaError) {
		let output = `Error: ${error.message}`;
		if (error.hint) {
			output += `\n\nHint: ${error.hint}`;
		}
		return output;
	}
	return `Error: ${error instanceof Error ? error.message : String(error)}`;
};

const createRl = () => readline.createInterface({ input: process.stdin, output: process.stdout });

const promptInput = async (rl: readline.Interface, question: string, defaultValue?: string) =>
	new Promise<string>((resolve) => {
		const defaultHint = defaultValue ? ` ${dim(`(${defaultValue})`)}` : '';
		rl.question(`${question}${defaultHint}: `, (answer) => {
			const value = answer.trim();
			resolve(value || defaultValue || '');
		});
	});

const promptConfirm = async (rl: readline.Interface, question: string) =>
	new Promise<boolean>((resolve) => {
		rl.question(`${question} ${dim('(y/n)')}: `, (answer) => {
			resolve(answer.trim().toLowerCase() === 'y');
		});
	});

const promptRepeated = async (rl: readline.Interface, itemName: string) => {
	const items: string[] = [];
	console.log(`\nEnter ${itemName} one at a time. Press Enter with empty input when done.`);

	while (true) {
		const value = await promptInput(rl, `  ${itemName} ${items.length + 1}`);
		if (!value) break;
		items.push(value);
	}

	return items;
};

const promptSelect = async <T extends string>(
	question: string,
	options: { label: string; value: T }[]
): Promise<T> =>
	new Promise((resolve, reject) => {
		const rl = createRl();

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
			resolve(options[selection - 1]!.value);
		});
	});

const parseRequiredInt = (raw: string, field: string, min: number) => {
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed < min) {
		throw new Error(`${field} must be an integer >= ${min}`);
	}
	return parsed;
};

const defaultWebsiteNameFromUrl = (url: string) => {
	const result = Result.try(() => new URL(url));
	return result.match({
		ok: (parsed) => {
			const host = parsed.hostname.split('.').filter(Boolean);
			const base = host.length > 1 ? host[host.length - 2] : (host[0] ?? 'website');
			const slug = (parsed.pathname.split('/').filter(Boolean).join('-') || '').replace(
				/[^a-zA-Z0-9._-]/g,
				''
			);
			return slug ? `${base}-${slug}` : base;
		},
		err: () => 'website'
	});
};

const addGitResourceWizard = async (
	url: string,
	options: { global?: boolean },
	globalOpts: { server?: string; port?: number } | undefined
) => {
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
		const finalUrl = await promptInput(rl, 'URL', normalizedUrl);
		const name = await promptInput(rl, 'Name', urlParts.repo);
		const branch = await promptInput(rl, 'Branch', 'main');
		const wantSearchPaths = await promptConfirm(
			rl,
			'Do you want to add search paths (subdirectories to focus on)?'
		);
		const searchPaths = wantSearchPaths ? await promptRepeated(rl, 'Search path') : [];
		const notes = await promptInput(rl, 'Notes (optional)');
		rl.close();

		console.log('\n--- Summary ---\n');
		console.log('  Type:    git');
		console.log(`  Name:    ${name}`);
		console.log(`  URL:     ${finalUrl}`);
		console.log(`  Branch:  ${branch}`);
		if (searchPaths.length > 0) console.log(`  Search:  ${searchPaths.join(', ')}`);
		if (notes) console.log(`  Notes:   ${notes}`);
		console.log(`  Config:  ${options.global ? 'global' : 'project'}`);
		console.log('');

		const confirmRl = createRl();
		const confirmed = await promptConfirm(confirmRl, 'Add this resource?');
		confirmRl.close();
		if (!confirmed) {
			console.log('\nCancelled.');
			process.exit(0);
		}

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
	if (Result.isError(result)) throw result.error;
};

const addLocalResourceWizard = async (
	localPath: string,
	options: { global?: boolean },
	globalOpts: { server?: string; port?: number } | undefined
) => {
	const resolvedPath = path.isAbsolute(localPath)
		? localPath
		: path.resolve(process.cwd(), localPath);
	console.log('\n--- Add Local Resource ---\n');
	console.log(`Directory: ${resolvedPath}`);

	const rl = createRl();
	const result = await Result.tryPromise(async () => {
		const finalPath = await promptInput(rl, 'Path', resolvedPath);
		const name = await promptInput(rl, 'Name', path.basename(finalPath));
		const notes = await promptInput(rl, 'Notes (optional)');
		rl.close();

		console.log('\n--- Summary ---\n');
		console.log('  Type:    local');
		console.log(`  Name:    ${name}`);
		console.log(`  Path:    ${finalPath}`);
		if (notes) console.log(`  Notes:   ${notes}`);
		console.log(`  Config:  ${options.global ? 'global' : 'project'}`);
		console.log('');

		const confirmRl = createRl();
		const confirmed = await promptConfirm(confirmRl, 'Add this resource?');
		confirmRl.close();
		if (!confirmed) {
			console.log('\nCancelled.');
			process.exit(0);
		}

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
	if (Result.isError(result)) throw result.error;
};

const addWebsiteResourceWizard = async (
	websiteUrl: string,
	options: { global?: boolean },
	globalOpts: { server?: string; port?: number } | undefined
) => {
	console.log('\n--- Add Website Resource ---\n');
	console.log(`Website: ${websiteUrl}`);

	const rl = createRl();
	const result = await Result.tryPromise(async () => {
		const finalUrl = await promptInput(rl, 'URL', websiteUrl);
		const name = await promptInput(rl, 'Name', defaultWebsiteNameFromUrl(finalUrl));
		const maxPages = parseRequiredInt(
			await promptInput(rl, 'Max Pages', String(DEFAULT_WEBSITE_MAX_PAGES)),
			'maxPages',
			1
		);
		const maxDepth = parseRequiredInt(
			await promptInput(rl, 'Max Depth', String(DEFAULT_WEBSITE_MAX_DEPTH)),
			'maxDepth',
			0
		);
		const ttlHours = parseRequiredInt(
			await promptInput(rl, 'TTL Hours', String(DEFAULT_WEBSITE_TTL_HOURS)),
			'ttlHours',
			1
		);
		const notes = await promptInput(rl, 'Notes (optional)');
		rl.close();

		console.log('\n--- Summary ---\n');
		console.log('  Type:       website');
		console.log(`  Name:       ${name}`);
		console.log(`  URL:        ${finalUrl}`);
		console.log(`  Max Pages:  ${maxPages}`);
		console.log(`  Max Depth:  ${maxDepth}`);
		console.log(`  TTL Hours:  ${ttlHours}`);
		if (notes) console.log(`  Notes:      ${notes}`);
		console.log(`  Config:     ${options.global ? 'global' : 'project'}`);
		console.log('');

		const confirmRl = createRl();
		const confirmed = await promptConfirm(confirmRl, 'Add this resource?');
		confirmRl.close();
		if (!confirmed) {
			console.log('\nCancelled.');
			process.exit(0);
		}

		const server = await ensureServer({
			serverUrl: globalOpts?.server,
			port: globalOpts?.port,
			quiet: true
		});

		await addResource(server.url, {
			type: 'website',
			name,
			url: finalUrl,
			maxPages,
			maxDepth,
			ttlHours,
			...(notes && { specialNotes: notes })
		});

		server.stop();
		console.log(`\nAdded resource: ${name}`);
		console.log('\nYou can now use this resource:');
		console.log(`  btca ask -r ${name} -q "your question"`);
	});

	rl.close();
	if (Result.isError(result)) throw result.error;
};

export const addCommand = new Command('add')
	.description('Add a resource (git repository, website, or local directory)')
	.argument('[url-or-path]', 'GitHub repository URL, website URL, or local directory path')
	.option('-g, --global', 'Add to global config instead of project config')
	.option('-n, --name <name>', 'Resource name')
	.option('-b, --branch <branch>', 'Git branch (default: main)')
	.option('-s, --search-path <path...>', 'Search paths within repo (can specify multiple)')
	.option('--max-pages <number>', 'Max pages for website crawl', (value) =>
		Number.parseInt(value, 10)
	)
	.option('--max-depth <number>', 'Max depth for website crawl', (value) =>
		Number.parseInt(value, 10)
	)
	.option('--ttl-hours <number>', 'Website cache TTL in hours', (value) =>
		Number.parseInt(value, 10)
	)
	.option('--notes <notes>', 'Special notes for the agent')
	.option('-t, --type <type>', 'Resource type: git, website, or local (auto-detected if omitted)')
	.action(
		async (
			urlOrPath: string | undefined,
			options: {
				global?: boolean;
				name?: string;
				branch?: string;
				searchPath?: string[];
				maxPages?: number;
				maxDepth?: number;
				ttlHours?: number;
				notes?: string;
				type?: string;
			},
			command
		) => {
			const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;

			const result = await Result.tryPromise(async () => {
				if (!urlOrPath) {
					const resourceType = await promptSelect<ResourceType>(
						'What type of resource do you want to add?',
						[
							{ label: 'Git repository', value: 'git' },
							{ label: 'Website', value: 'website' },
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
						return;
					}
					if (resourceType === 'website') {
						const url = await promptInput(rl, 'Website URL');
						rl.close();
						if (!url) {
							console.error('Error: URL is required.');
							process.exit(1);
						}
						await addWebsiteResourceWizard(url, options, globalOpts);
						return;
					}

					const localPath = await promptInput(rl, 'Local path');
					rl.close();
					if (!localPath) {
						console.error('Error: Path is required.');
						process.exit(1);
					}
					await addLocalResourceWizard(localPath, options, globalOpts);
					return;
				}

				let resourceType: ResourceType = 'git';
				if (options.type) {
					if (options.type !== 'git' && options.type !== 'website' && options.type !== 'local') {
						console.error('Error: --type must be "git", "website", or "local"');
						process.exit(1);
					}
					resourceType = options.type as ResourceType;
				} else {
					const looksLikeUrl =
						urlOrPath.startsWith('http://') ||
						urlOrPath.startsWith('https://') ||
						urlOrPath.startsWith('github.com/') ||
						urlOrPath.includes('github.com/');
					resourceType = looksLikeUrl ? 'git' : 'local';
				}

				if (options.name && resourceType === 'git' && parseGitHubUrl(urlOrPath)) {
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

				if (options.name && resourceType === 'website') {
					if (!urlOrPath.startsWith('http://') && !urlOrPath.startsWith('https://')) {
						console.error('Error: website resources require an absolute URL.');
						process.exit(1);
					}
					const server = await ensureServer({
						serverUrl: globalOpts?.server,
						port: globalOpts?.port,
						quiet: true
					});

					const maxPages = options.maxPages ?? DEFAULT_WEBSITE_MAX_PAGES;
					const maxDepth = options.maxDepth ?? DEFAULT_WEBSITE_MAX_DEPTH;
					const ttlHours = options.ttlHours ?? DEFAULT_WEBSITE_TTL_HOURS;
					if (!Number.isFinite(maxPages) || maxPages < 1) {
						throw new Error('maxPages must be an integer >= 1');
					}
					if (!Number.isFinite(maxDepth) || maxDepth < 0) {
						throw new Error('maxDepth must be an integer >= 0');
					}
					if (!Number.isFinite(ttlHours) || ttlHours < 1) {
						throw new Error('ttlHours must be an integer >= 1');
					}

					await addResource(server.url, {
						type: 'website',
						name: options.name,
						url: urlOrPath,
						maxPages,
						maxDepth,
						ttlHours,
						...(options.notes && { specialNotes: options.notes })
					});

					server.stop();
					console.log(`Added website resource: ${options.name}`);
					return;
				}

				if (options.name && resourceType === 'local') {
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

				if (resourceType === 'git') {
					await addGitResourceWizard(urlOrPath, options, globalOpts);
					return;
				}
				if (resourceType === 'website') {
					await addWebsiteResourceWizard(urlOrPath, options, globalOpts);
					return;
				}
				await addLocalResourceWizard(urlOrPath, options, globalOpts);
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
