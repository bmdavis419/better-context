import select from '@inquirer/select';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as readline from 'readline';
import { Effect } from 'effect';

const PROJECT_CONFIG_FILENAME = 'btca.config.jsonc';
const CONFIG_SCHEMA_URL = 'https://btca.dev/btca.schema.json';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_PROVIDER = 'opencode';

type StorageType = 'local' | 'global';

async function promptSelect<T extends string>(
	question: string,
	options: { label: string; value: T }[]
): Promise<T> {
	if (options.length === 0) {
		throw new Error('Invalid selection');
	}

	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return new Promise((resolve, reject) => {
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
				const num = Number.parseInt(answer.trim(), 10);
				if (!Number.isFinite(num) || num < 1 || num > options.length) {
					reject(new Error('Invalid selection'));
					return;
				}
				resolve(options[num - 1]!.value);
			});
		});
	}

	const selection = await select({
		message: question,
		choices: options.map((option) => ({
			name: option.label,
			value: option.value
		}))
	});
	return selection as T;
}

async function isPatternInGitignore(dir: string, pattern: string): Promise<boolean> {
	const gitignorePath = path.join(dir, '.gitignore');
	let content: string;
	try {
		content = await fs.readFile(gitignorePath, 'utf-8');
	} catch {
		return false;
	}
	const lines = content.split('\n').map((line) => line.trim());
	const basePattern = pattern.replace(/\/$/, '');
	const patterns = [basePattern, `${basePattern}/`, `${basePattern}/*`];

	return lines.some((line) => {
		if (line.startsWith('#') || line === '') return false;
		return patterns.includes(line);
	});
}

async function addToGitignore(dir: string, pattern: string, comment?: string): Promise<void> {
	const gitignorePath = path.join(dir, '.gitignore');
	let content = '';
	try {
		content = await fs.readFile(gitignorePath, 'utf-8');
	} catch {
		content = '';
	}
	if (content && !content.endsWith('\n')) {
		content += '\n';
	}

	if (comment) {
		content += `\n${comment}\n`;
	}
	content += `${pattern}\n`;

	await fs.writeFile(gitignorePath, content, 'utf-8');
}

async function isGitRepo(dir: string): Promise<boolean> {
	try {
		await fs.access(path.join(dir, '.git'));
		return true;
	} catch {
		return false;
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function handleCliSetup(cwd: string, configPath: string, force?: boolean): Promise<void> {
	if (await fileExists(configPath)) {
		if (!force) {
			throw new Error(
				`${PROJECT_CONFIG_FILENAME} already exists at ${configPath}. Use --force to overwrite.`
			);
		}
		console.log(`\nOverwriting existing ${PROJECT_CONFIG_FILENAME}...`);
	}

	const storageType = await promptSelect<StorageType>('Where should btca store cloned resources?', [
		{ label: 'Local (.btca/ in this project)', value: 'local' },
		{ label: 'Global (~/.local/share/btca/)', value: 'global' }
	]);

	const config: Record<string, unknown> = {
		$schema: CONFIG_SCHEMA_URL,
		model: DEFAULT_MODEL,
		provider: DEFAULT_PROVIDER,
		resources: []
	};

	if (storageType === 'local') {
		config.dataDirectory = '.btca';
	}

	await fs.writeFile(configPath, JSON.stringify(config, null, '\t'), 'utf-8');
	console.log(`\nCreated ${PROJECT_CONFIG_FILENAME}`);

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

	if (storageType === 'local') {
		console.log('\nData directory: .btca/ (local to this project)');
	} else {
		console.log('\nData directory: ~/.local/share/btca/ (global)');
	}

	console.log('\n--- Setup Complete (CLI) ---\n');
	console.log('Next steps:');
	console.log('  1. Add resources: btca add https://github.com/owner/repo');
	console.log('  2. Ask a question: btca ask -r <resource> -q "your question"');
	console.log('  3. Or launch the TUI: btca');
	console.log("\nRun 'btca --help' for more options.");
}

export const runInitCommand = (args: { force?: boolean }) =>
	Effect.tryPromise({
		try: async () => {
			const cwd = process.cwd();
			const configPath = path.join(cwd, PROJECT_CONFIG_FILENAME);
			await handleCliSetup(cwd, configPath, args.force);
		},
		catch: (error) => error
	});
