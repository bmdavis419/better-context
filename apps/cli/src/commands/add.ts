import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Result } from 'better-result';
import { Command } from 'commander';
import * as readline from 'readline';

import { addResource, BtcaError } from '../client/index.ts';
import { dim } from '../lib/utils/colors.ts';
import { ensureServer } from '../server/manager.ts';

interface GitHubUrlParts {
	owner: string;
	repo: string;
}

interface NpmReferenceParts {
	packageName: string;
	version?: string;
}

const NPM_PACKAGE_SEGMENT_REGEX = /^[a-z0-9][a-z0-9._-]*$/;
const NPM_VERSION_OR_TAG_REGEX = /^[^\s/]+$/;

/**
 * Parse a GitHub URL and extract owner/repo.
 */
function parseGitHubUrl(url: string): GitHubUrlParts | null {
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

const isValidNpmPackageName = (name: string) => {
	if (name.startsWith('@')) {
		const [scope, pkg, ...rest] = name.split('/');
		return (
			rest.length === 0 &&
			!!scope &&
			scope.length > 1 &&
			!!pkg &&
			NPM_PACKAGE_SEGMENT_REGEX.test(scope.slice(1)) &&
			NPM_PACKAGE_SEGMENT_REGEX.test(pkg)
		);
	}

	return !name.includes('/') && NPM_PACKAGE_SEGMENT_REGEX.test(name);
};

const splitNpmSpec = (spec: string): NpmReferenceParts | null => {
	if (!spec) return null;
	if (spec.startsWith('@')) {
		const secondAt = spec.indexOf('@', 1);
		if (secondAt === -1) return { packageName: spec };
		const packageName = spec.slice(0, secondAt);
		const version = spec.slice(secondAt + 1);
		return version ? { packageName, version } : null;
	}

	const at = spec.lastIndexOf('@');
	if (at <= 0) return { packageName: spec };
	const packageName = spec.slice(0, at);
	const version = spec.slice(at + 1);
	return version ? { packageName, version } : null;
};

const safeDecodeUriComponent = (value: string) =>
	Result.try(() => decodeURIComponent(value)).match({
		ok: (decoded) => decoded,
		err: () => null
	});

const parseNpmFromUrl = (reference: string): NpmReferenceParts | null => {
	const parsed = Result.try(() => new URL(reference)).match({
		ok: (value) => value,
		err: () => null
	});
	if (!parsed) return null;

	const hostname = parsed.hostname.toLowerCase();
	if (parsed.protocol !== 'https:' || (hostname !== 'npmjs.com' && hostname !== 'www.npmjs.com')) {
		return null;
	}

	const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
	if (segments[0] !== 'package') return null;

	const packageParts = segments[1]?.startsWith('@') ? segments.slice(1, 3) : segments.slice(1, 2);
	if (packageParts.length === 0 || packageParts.some((part) => !part)) return null;

	const decodedPackageParts = packageParts.map(safeDecodeUriComponent);
	if (decodedPackageParts.some((part) => !part)) return null;
	const packageName = decodedPackageParts.join('/');
	if (!isValidNpmPackageName(packageName)) return null;

	const remainder = segments.slice(1 + packageParts.length);
	if (remainder.length === 0) return { packageName };
	if (remainder.length === 2 && remainder[0] === 'v') {
		const version = safeDecodeUriComponent(remainder[1]!);
		if (!version) return null;
		if (!NPM_VERSION_OR_TAG_REGEX.test(version)) return null;
		return { packageName, version };
	}

	return null;
};

const parseNpmReference = (reference: string): NpmReferenceParts | null => {
	const trimmed = reference.trim();
	if (!trimmed) return null;

	const fromUrl = parseNpmFromUrl(trimmed);
	if (fromUrl) return fromUrl;

	const spec = trimmed.startsWith('npm:') ? trimmed.slice(4) : trimmed;
	const parsed = splitNpmSpec(spec);
	if (!parsed) return null;
	if (!isValidNpmPackageName(parsed.packageName)) return null;
	if (parsed.version && !NPM_VERSION_OR_TAG_REGEX.test(parsed.version)) return null;
	return parsed;
};

const isLikelyPath = (value: string) =>
	value.startsWith('/') ||
	value.startsWith('./') ||
	value.startsWith('../') ||
	value.startsWith('~/') ||
	/^[a-zA-Z]:\\/.test(value);

const isLikelyGitUrl = (value: string) =>
	Result.try(() => new URL(value)).match({
		ok: (parsed) => parsed.protocol === 'https:',
		err: () => false
	});

const isDirectory = async (value: string) => {
	const resolved = path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
	const result = await Result.tryPromise(() => fs.stat(resolved));
	return result.match({
		ok: (stat) => stat.isDirectory(),
		err: () => false
	});
};

/**
 * Format an error for display, including hint if available.
 */
function formatError(error: unknown): string {
	if (error instanceof BtcaError) {
		let output = `Error: ${error.message}`;
		if (error.hint) output += `\n\nHint: ${error.hint}`;
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
}

/**
 * Interactive wizard for adding a local resource.
 */
async function addLocalResourceWizard(
	localPath: string,
	options: { global?: boolean },
	globalOpts: { server?: string; port?: number } | undefined
): Promise<void> {
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
}

/**
 * Interactive wizard for adding an npm resource.
 */
async function addNpmResourceWizard(
	npmReference: string,
	options: { global?: boolean },
	globalOpts: { server?: string; port?: number } | undefined
): Promise<void> {
	const parsed = parseNpmReference(npmReference);
	if (!parsed) {
		console.error('Error: Invalid npm reference.');
		console.error('Use an npm package (e.g. react, @types/node, npm:react, or npmjs package URL).');
		process.exit(1);
	}

	console.log('\n--- Add npm Resource ---\n');
	console.log(`Package: ${parsed.packageName}${parsed.version ? `@${parsed.version}` : ''}`);

	const rl = createRl();

	const result = await Result.tryPromise(async () => {
		const packageName = await promptInput(rl, 'Package', parsed.packageName);
		const versionInput = await promptInput(rl, 'Version/tag (optional)', parsed.version ?? '');
		const name = await promptInput(rl, 'Name', packageName);
		const notes = await promptInput(rl, 'Notes (optional)');

		rl.close();

		console.log('\n--- Summary ---\n');
		console.log('  Type:    npm');
		console.log(`  Name:    ${name}`);
		console.log(`  Package: ${packageName}`);
		console.log(`  Version: ${versionInput || 'latest'}`);
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
			type: 'npm',
			name,
			package: packageName,
			...(versionInput ? { version: versionInput } : {}),
			...(notes ? { specialNotes: notes } : {})
		});

		server.stop();

		console.log(`\nAdded resource: ${name}`);
		console.log('\nYou can now use this resource:');
		console.log(`  btca ask -r ${name} -q "your question"`);
	});

	rl.close();

	if (Result.isError(result)) throw result.error;
}

const inferResourceType = async (value: string): Promise<'git' | 'local' | 'npm'> => {
	if (parseGitHubUrl(value)) return 'git';
	if (await isDirectory(value)) return 'local';
	if (isLikelyPath(value)) return 'local';
	if (parseNpmReference(value)) return 'npm';
	if (isLikelyGitUrl(value)) return 'git';
	return 'local';
};

export const addCommand = new Command('add')
	.description('Add a resource (git repository, local directory, or npm package)')
	.argument('[reference]', 'Repository URL, local path, or npm package reference')
	.option('-g, --global', 'Add to global config instead of project config')
	.option('-n, --name <name>', 'Resource name')
	.option('-b, --branch <branch>', 'Git branch (default: main)')
	.option('-s, --search-path <path...>', 'Search paths within repo (can specify multiple)')
	.option('--notes <notes>', 'Special notes for the agent')
	.option('-t, --type <type>', 'Resource type: git, local, or npm (auto-detected if not specified)')
	.action(
		async (
			reference: string | undefined,
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
				if (!reference) {
					const resourceType = await promptSelect<'git' | 'local' | 'npm'>(
						'What type of resource do you want to add?',
						[
							{ label: 'Git repository', value: 'git' },
							{ label: 'npm package', value: 'npm' },
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

					if (resourceType === 'npm') {
						const npmRef = await promptInput(rl, 'npm package (or npmjs URL)', 'react');
						rl.close();
						if (!npmRef) {
							console.error('Error: npm package is required.');
							process.exit(1);
						}
						await addNpmResourceWizard(npmRef, options, globalOpts);
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

				let resourceType: 'git' | 'local' | 'npm';
				if (options.type) {
					if (options.type !== 'git' && options.type !== 'local' && options.type !== 'npm') {
						console.error('Error: --type must be "git", "local", or "npm"');
						process.exit(1);
					}
					resourceType = options.type as 'git' | 'local' | 'npm';
				} else {
					resourceType = await inferResourceType(reference);
				}

				if (options.name && resourceType === 'git' && parseGitHubUrl(reference)) {
					const normalizedUrl = normalizeGitHubUrl(reference);
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
					const resolvedPath = path.isAbsolute(reference)
						? reference
						: path.resolve(process.cwd(), reference);
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

				if (options.name && resourceType === 'npm') {
					const parsed = parseNpmReference(reference);
					if (!parsed) {
						console.error('Error: Invalid npm reference.');
						console.error(
							'Use an npm package (e.g. react, @types/node, npm:react, or npmjs package URL).'
						);
						process.exit(1);
					}

					const server = await ensureServer({
						serverUrl: globalOpts?.server,
						port: globalOpts?.port,
						quiet: true
					});

					await addResource(server.url, {
						type: 'npm',
						name: options.name,
						package: parsed.packageName,
						...(parsed.version ? { version: parsed.version } : {}),
						...(options.notes ? { specialNotes: options.notes } : {})
					});

					server.stop();
					console.log(`Added npm resource: ${options.name}`);
					return;
				}

				if (resourceType === 'git') {
					await addGitResourceWizard(reference, options, globalOpts);
				} else if (resourceType === 'npm') {
					await addNpmResourceWizard(reference, options, globalOpts);
				} else {
					await addLocalResourceWizard(reference, options, globalOpts);
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
