import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const PROJECT_CONFIG_FILENAME = 'btca.config.jsonc';
const CONFIG_SCHEMA_URL = 'https://btca.dev/btca.schema.json';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_PROVIDER = 'opencode';

/**
 * Check if a .gitignore file exists in the given directory.
 */
async function hasGitignore(dir: string): Promise<boolean> {
	try {
		await fs.access(path.join(dir, '.gitignore'));
		return true;
	} catch {
		return false;
	}
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

export const initCommand = new Command('init')
	.description('Initialize a btca project configuration')
	.option('-l, --local', 'Use local .btca directory for data storage')
	.option('-f, --force', 'Overwrite existing configuration')
	.action(async (options: { local?: boolean; force?: boolean }) => {
		const cwd = process.cwd();
		const configPath = path.join(cwd, PROJECT_CONFIG_FILENAME);

		try {
			// Check if config already exists
			if (await fileExists(configPath)) {
				if (!options.force) {
					console.error(`Error: ${PROJECT_CONFIG_FILENAME} already exists.`);
					console.error('Use --force to overwrite.');
					process.exit(1);
				}
				console.log(`Overwriting existing ${PROJECT_CONFIG_FILENAME}...`);
			}

			// Build the config
			const config: Record<string, unknown> = {
				$schema: CONFIG_SCHEMA_URL,
				model: DEFAULT_MODEL,
				provider: DEFAULT_PROVIDER,
				resources: []
			};

			// Add dataDirectory if --local flag is used
			if (options.local) {
				config.dataDirectory = '.btca';
			}

			// Write config file
			const configContent = JSON.stringify(config, null, '\t');
			await fs.writeFile(configPath, configContent, 'utf-8');

			console.log(`Created ${PROJECT_CONFIG_FILENAME}`);

			// Handle .gitignore if using local data directory
			if (options.local) {
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

				console.log('\nData directory: .btca/ (local to this project)');
			} else {
				console.log('\nData directory: ~/.local/share/btca/ (global)');
			}

			console.log('\nNext steps:');
			console.log('  1. Add resources: btca config resources add -n <name> -t git -u <url>');
			console.log('  2. Ask a question: btca ask -r <resource> -q "your question"');
			console.log("\nRun 'btca --help' for more options.");
		} catch (error) {
			console.error('Error:', error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	});
