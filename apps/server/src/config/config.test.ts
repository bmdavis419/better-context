import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { Config, DEFAULT_MODEL, DEFAULT_PROVIDER, DEFAULT_RESOURCES } from './index.ts';

describe('Config', () => {
	let testDir: string;
	let originalCwd: string;
	let originalHome: string | undefined;

	beforeEach(async () => {
		testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'btca-config-test-'));
		originalCwd = process.cwd();
		originalHome = process.env.HOME;
		// Point HOME to test dir so global config goes there
		process.env.HOME = testDir;
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		process.env.HOME = originalHome;
		await fs.rm(testDir, { recursive: true, force: true });
	});

	describe('Config.load', () => {
		it('creates default config when no config exists', async () => {
			process.chdir(testDir);

			const config = await Config.load();

			expect(config.provider).toBe(DEFAULT_PROVIDER);
			expect(config.model).toBe(DEFAULT_MODEL);
			expect(config.resources.length).toBe(DEFAULT_RESOURCES.length);
			expect(config.getResource('svelte')).toBeDefined();
		});

		it('loads project config when btca.config.jsonc exists in cwd', async () => {
			const projectConfig = {
				$schema: 'https://btca.dev/btca.schema.json',
				provider: 'test-provider',
				model: 'test-model',
				resources: [
					{
						name: 'test-resource',
						type: 'git',
						url: 'https://github.com/test/repo',
						branch: 'main'
					}
				]
			};

			await fs.writeFile(path.join(testDir, 'btca.config.jsonc'), JSON.stringify(projectConfig));
			process.chdir(testDir);

			const config = await Config.load();

			expect(config.provider).toBe('test-provider');
			expect(config.model).toBe('test-model');
			expect(config.resources.length).toBe(1);
			expect(config.resources[0]?.name).toBe('test-resource');
		});

		it('handles JSONC with comments', async () => {
			const projectConfigWithComments = `{
				// This is a comment
				"$schema": "https://btca.dev/btca.schema.json",
				"provider": "commented-provider",
				"model": "commented-model",
				/* Multi-line
				   comment */
				"resources": [
					{
						"name": "commented-resource",
						"type": "git",
						"url": "https://github.com/test/repo",
						"branch": "main",
					}
				],
			}`;

			await fs.writeFile(path.join(testDir, 'btca.config.jsonc'), projectConfigWithComments);
			process.chdir(testDir);

			const config = await Config.load();

			expect(config.provider).toBe('commented-provider');
			expect(config.model).toBe('commented-model');
		});

		it('getResource returns undefined for unknown resource', async () => {
			process.chdir(testDir);

			const config = await Config.load();

			expect(config.getResource('nonexistent')).toBeUndefined();
		});

		it('throws ConfigError for invalid JSON', async () => {
			await fs.writeFile(path.join(testDir, 'btca.config.jsonc'), 'not valid json {{{');
			process.chdir(testDir);

			expect(Config.load()).rejects.toThrow('Failed to parse config JSONC');
		});

		it('throws ConfigError for invalid schema', async () => {
			const invalidConfig = {
				provider: 'test'
				// missing required fields
			};

			await fs.writeFile(path.join(testDir, 'btca.config.jsonc'), JSON.stringify(invalidConfig));
			process.chdir(testDir);

			expect(Config.load()).rejects.toThrow('Invalid config');
		});
	});
});
