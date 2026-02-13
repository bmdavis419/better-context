import { Result } from 'better-result';
import { Command } from 'commander';
import select from '@inquirer/select';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as readline from 'readline';

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
	const result = await Result.tryPromise(() => fs.readFile(gitignorePath, 'utf-8'));
	if (Result.isError(result)) return false;
	const lines = result.value.split('\n').map((line) => line.trim());
	const basePattern = pattern.replace(/\/$/, '');
	const patterns = [basePattern, `${basePattern}/`, `${basePattern}/*`];

	return lines.some((line) => {
		if (line.startsWith('#') || line === '') return false;
		return patterns.includes(line);
	});
}

async function addToGitignore(dir: string, pattern: string, comment?: string): Promise<void> {
	const gitignorePath = path.join(dir, '.gitignore');
	const contentResult = await Result.tryPromise(() => fs.readFile(gitignorePath, 'utf-8'));
	let content = Result.isOk(contentResult) ? contentResult.value : '';
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
	const result = await Result.tryPromise(() => fs.access(path.join(dir, '.git')));
	return Result.isOk(result);
}

async function fileExists(filePath: string): Promise<boolean> {
	const result = await Result.tryPromise(() => fs.access(filePath));
	return Result.isOk(result);
}

async function handleCliSetup(cwd: string, configPath: string, force?: boolean): Promise<void> {
	if (await fileExists(configPath)) {
		if (!force) {
			console.error(`\nError: ${PROJECT_CONFIG_FILENAME} already exists.`);
			console.error('Use --force to overwrite.');
			process.exit(1);
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

export const initCommand = new Command('init')
	.description('Initialize btca for this project')
	.option('-f, --force', 'Overwrite existing configuration')
	.action(async (options: { force?: boolean }) => {
		const cwd = process.cwd();
		const configPath = path.join(cwd, PROJECT_CONFIG_FILENAME);

		const result = await Result.tryPromise(async () => {
			await handleCliSetup(cwd, configPath, options.force);
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
