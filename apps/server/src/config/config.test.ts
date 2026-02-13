import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
	Config,
	DEFAULT_MAX_STEPS,
	DEFAULT_MODEL,
	DEFAULT_PROVIDER,
	DEFAULT_RESOURCES
} from './index.ts';

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
			expect(config.maxSteps).toBe(DEFAULT_MAX_STEPS);
			expect(config.resources.length).toBe(DEFAULT_RESOURCES.length);
			expect(config.getResource('svelte')).toBeDefined();
		});

		it('loads project config when btca.config.jsonc exists in cwd (merged with global)', async () => {
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

			// Project provider/model should take priority
			expect(config.provider).toBe('test-provider');
			expect(config.model).toBe('test-model');
			// Resources are merged: 1 project resource + 3 default resources = 4 total
			expect(config.resources.length).toBe(1 + DEFAULT_RESOURCES.length);
			expect(config.getResource('test-resource')).toBeDefined();
			// Default resources should still be present
			expect(config.getResource('svelte')).toBeDefined();
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

		it('loads maxSteps when provided in config', async () => {
			const projectConfig = {
				$schema: 'https://btca.dev/btca.schema.json',
				provider: 'test-provider',
				model: 'test-model',
				maxSteps: 80,
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

			expect(config.maxSteps).toBe(80);
		});

		it('getResource returns undefined for unknown resource', async () => {
			process.chdir(testDir);

			const config = await Config.load();

			expect(config.getResource('nonexistent')).toBeUndefined();
		});

		it('throws ConfigError for invalid JSON', async () => {
			await fs.writeFile(path.join(testDir, 'btca.config.jsonc'), 'not valid json {{{');
			process.chdir(testDir);

			expect(Config.load()).rejects.toThrow('Failed to parse config file');
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

		it('throws ConfigError for invalid maxSteps', async () => {
			const invalidConfig = {
				$schema: 'https://btca.dev/btca.schema.json',
				provider: 'test-provider',
				model: 'test-model',
				maxSteps: 0,
				resources: [
					{
						name: 'test-resource',
						type: 'git',
						url: 'https://github.com/test/repo',
						branch: 'main'
					}
				]
			};

			await fs.writeFile(path.join(testDir, 'btca.config.jsonc'), JSON.stringify(invalidConfig));
			process.chdir(testDir);

			expect(Config.load()).rejects.toThrow('Invalid config');
		});

		it('merges project config with global config (project takes priority)', async () => {
			// Create global config with some resources
			const globalConfigDir = path.join(testDir, '.config', 'btca');
			await fs.mkdir(globalConfigDir, { recursive: true });
			const globalConfig = {
				$schema: 'https://btca.dev/btca.schema.json',
				provider: 'global-provider',
				model: 'global-model',
				resources: [
					{
						name: 'shared-resource',
						type: 'git',
						url: 'https://github.com/global/repo',
						branch: 'main'
					},
					{
						name: 'global-only-resource',
						type: 'git',
						url: 'https://github.com/global/only',
						branch: 'main'
					}
				]
			};
			await fs.writeFile(
				path.join(globalConfigDir, 'btca.config.jsonc'),
				JSON.stringify(globalConfig)
			);

			// Create project config that overrides some settings
			const projectDir = path.join(testDir, 'my-project');
			await fs.mkdir(projectDir, { recursive: true });
			const projectConfig = {
				$schema: 'https://btca.dev/btca.schema.json',
				provider: 'project-provider',
				model: 'project-model',
				resources: [
					{
						name: 'shared-resource',
						type: 'git',
						url: 'https://github.com/project/repo', // Different URL - should override
						branch: 'develop'
					},
					{
						name: 'project-only-resource',
						type: 'git',
						url: 'https://github.com/project/only',
						branch: 'main'
					}
				]
			};
			await fs.writeFile(path.join(projectDir, 'btca.config.jsonc'), JSON.stringify(projectConfig));
			process.chdir(projectDir);

			const config = await Config.load();

			// Project provider/model should take priority
			expect(config.provider).toBe('project-provider');
			expect(config.model).toBe('project-model');

			// Should have 3 resources: shared (from project), global-only, project-only
			expect(config.resources.length).toBe(3);

			// shared-resource should have project's URL (override)
			const sharedResource = config.getResource('shared-resource');
			expect(sharedResource).toBeDefined();
			expect(sharedResource?.type).toBe('git');
			if (sharedResource?.type === 'git') {
				expect(sharedResource.url).toBe('https://github.com/project/repo');
				expect(sharedResource.branch).toBe('develop');
			}

			// global-only-resource should still be present
			const globalOnlyResource = config.getResource('global-only-resource');
			expect(globalOnlyResource).toBeDefined();
			if (globalOnlyResource?.type === 'git') {
				expect(globalOnlyResource.url).toBe('https://github.com/global/only');
			}

			// project-only-resource should be present
			const projectOnlyResource = config.getResource('project-only-resource');
			expect(projectOnlyResource).toBeDefined();
			if (projectOnlyResource?.type === 'git') {
				expect(projectOnlyResource.url).toBe('https://github.com/project/only');
			}
		});

		it('uses only global config when no project config exists', async () => {
			// Create global config
			const globalConfigDir = path.join(testDir, '.config', 'btca');
			await fs.mkdir(globalConfigDir, { recursive: true });
			const globalConfig = {
				$schema: 'https://btca.dev/btca.schema.json',
				provider: 'global-provider',
				model: 'global-model',
				resources: [
					{
						name: 'global-resource',
						type: 'git',
						url: 'https://github.com/global/repo',
						branch: 'main'
					}
				]
			};
			await fs.writeFile(
				path.join(globalConfigDir, 'btca.config.jsonc'),
				JSON.stringify(globalConfig)
			);

			// Create project directory without config
			const projectDir = path.join(testDir, 'my-project');
			await fs.mkdir(projectDir, { recursive: true });
			process.chdir(projectDir);

			const config = await Config.load();

			expect(config.provider).toBe('global-provider');
			expect(config.model).toBe('global-model');
			expect(config.resources.length).toBe(1);
			expect(config.getResource('global-resource')).toBeDefined();
		});
	});

	describe('Config mutations (resource leakage prevention)', () => {
		it('addResource only adds to project config, not global resources', async () => {
			// Create global config with some resources
			const globalConfigDir = path.join(testDir, '.config', 'btca');
			await fs.mkdir(globalConfigDir, { recursive: true });
			const globalConfig = {
				$schema: 'https://btca.dev/btca.schema.json',
				provider: 'global-provider',
				model: 'global-model',
				resources: [
					{
						name: 'svelte',
						type: 'git',
						url: 'https://github.com/sveltejs/svelte.dev',
						branch: 'main'
					},
					{
						name: 'tailwind',
						type: 'git',
						url: 'https://github.com/tailwindlabs/tailwindcss.com',
						branch: 'main'
					}
				]
			};
			await fs.writeFile(
				path.join(globalConfigDir, 'btca.config.jsonc'),
				JSON.stringify(globalConfig)
			);

			// Create project config with one resource
			const projectDir = path.join(testDir, 'my-project');
			await fs.mkdir(projectDir, { recursive: true });
			const projectConfig = {
				$schema: 'https://btca.dev/btca.schema.json',
				provider: 'project-provider',
				model: 'project-model',
				resources: [
					{
						name: 'myproject',
						type: 'git',
						url: 'https://github.com/test/myproject',
						branch: 'main'
					}
				]
			};
			const projectConfigPath = path.join(projectDir, 'btca.config.jsonc');
			await fs.writeFile(projectConfigPath, JSON.stringify(projectConfig));
			process.chdir(projectDir);

			const config = await Config.load();

			// Verify merged state: 3 resources (2 global + 1 project)
			expect(config.resources.length).toBe(3);

			// Add a new resource
			await config.addResource({
				name: 'new-resource',
				type: 'git',
				url: 'https://github.com/test/new-resource',
				branch: 'main'
			});

			// Verify merged state shows 4 resources
			expect(config.resources.length).toBe(4);
			expect(config.getResource('new-resource')).toBeDefined();

			// CRITICAL: Read the project config file and verify it only has project resources
			const savedProjectConfig = JSON.parse(await fs.readFile(projectConfigPath, 'utf-8'));
			expect(savedProjectConfig.resources.length).toBe(2); // myproject + new-resource
			expect(savedProjectConfig.resources.map((r: { name: string }) => r.name)).toEqual([
				'myproject',
				'new-resource'
			]);
			// Global resources should NOT be in project config
			expect(
				savedProjectConfig.resources.find((r: { name: string }) => r.name === 'svelte')
			).toBeUndefined();
			expect(
				savedProjectConfig.resources.find((r: { name: string }) => r.name === 'tailwind')
			).toBeUndefined();
		});

		it('removeResource only removes from project config, errors for global resources', async () => {
			// Create global config with some resources
			const globalConfigDir = path.join(testDir, '.config', 'btca');
			await fs.mkdir(globalConfigDir, { recursive: true });
			const globalConfig = {
				$schema: 'https://btca.dev/btca.schema.json',
				provider: 'global-provider',
				model: 'global-model',
				resources: [
					{
						name: 'svelte',
						type: 'git',
						url: 'https://github.com/sveltejs/svelte.dev',
						branch: 'main'
					},
					{
						name: 'tailwind',
						type: 'git',
						url: 'https://github.com/tailwindlabs/tailwindcss.com',
						branch: 'main'
					}
				]
			};
			const globalConfigPath = path.join(globalConfigDir, 'btca.config.jsonc');
			await fs.writeFile(globalConfigPath, JSON.stringify(globalConfig));

			// Create project config with one resource
			const projectDir = path.join(testDir, 'my-project');
			await fs.mkdir(projectDir, { recursive: true });
			const projectConfig = {
				$schema: 'https://btca.dev/btca.schema.json',
				provider: 'project-provider',
				model: 'project-model',
				resources: [
					{
						name: 'myproject',
						type: 'git',
						url: 'https://github.com/test/myproject',
						branch: 'main'
					}
				]
			};
			const projectConfigPath = path.join(projectDir, 'btca.config.jsonc');
			await fs.writeFile(projectConfigPath, JSON.stringify(projectConfig));
			process.chdir(projectDir);

			const config = await Config.load();

			// Verify merged state: 3 resources (2 global + 1 project)
			expect(config.resources.length).toBe(3);

			// Remove the project resource
			await config.removeResource('myproject');

			// Verify merged state shows 2 resources (only global)
			expect(config.resources.length).toBe(2);
			expect(config.getResource('myproject')).toBeUndefined();

			// CRITICAL: Read the project config file and verify it's empty
			const savedProjectConfig = JSON.parse(await fs.readFile(projectConfigPath, 'utf-8'));
			expect(savedProjectConfig.resources.length).toBe(0);
			// Global resources should NOT have leaked into project config
			expect(
				savedProjectConfig.resources.find((r: { name: string }) => r.name === 'svelte')
			).toBeUndefined();
			expect(
				savedProjectConfig.resources.find((r: { name: string }) => r.name === 'tailwind')
			).toBeUndefined();

			// Trying to remove a global resource should throw an error
			expect(config.removeResource('svelte')).rejects.toThrow(
				'Resource "svelte" is defined in the global config'
			);

			// Verify global config is unchanged
			const savedGlobalConfig = JSON.parse(await fs.readFile(globalConfigPath, 'utf-8'));
			expect(savedGlobalConfig.resources.length).toBe(2);
			expect(savedGlobalConfig.resources.map((r: { name: string }) => r.name)).toEqual([
				'svelte',
				'tailwind'
			]);
		});

		it('updateModel only updates project config, not global', async () => {
			// Create global config
			const globalConfigDir = path.join(testDir, '.config', 'btca');
			await fs.mkdir(globalConfigDir, { recursive: true });
			const globalConfig = {
				$schema: 'https://btca.dev/btca.schema.json',
				provider: 'global-provider',
				model: 'global-model',
				resources: [
					{
						name: 'svelte',
						type: 'git',
						url: 'https://github.com/sveltejs/svelte.dev',
						branch: 'main'
					}
				]
			};
			const globalConfigPath = path.join(globalConfigDir, 'btca.config.jsonc');
			await fs.writeFile(globalConfigPath, JSON.stringify(globalConfig));

			// Create project config
			const projectDir = path.join(testDir, 'my-project');
			await fs.mkdir(projectDir, { recursive: true });
			const projectConfig = {
				$schema: 'https://btca.dev/btca.schema.json',
				provider: 'project-provider',
				model: 'project-model',
				resources: []
			};
			const projectConfigPath = path.join(projectDir, 'btca.config.jsonc');
			await fs.writeFile(projectConfigPath, JSON.stringify(projectConfig));
			process.chdir(projectDir);

			const config = await Config.load();

			// Update the model
			const nextProvider = 'openrouter';
			const nextModel = 'openai/gpt-4o-mini';
			await config.updateModel(nextProvider, nextModel);

			expect(config.provider).toBe(nextProvider);
			expect(config.model).toBe(nextModel);

			// CRITICAL: Verify project config was updated
			const savedProjectConfig = JSON.parse(await fs.readFile(projectConfigPath, 'utf-8'));
			expect(savedProjectConfig.provider).toBe(nextProvider);
			expect(savedProjectConfig.model).toBe(nextModel);
			// Global resources should NOT have leaked into project config
			expect(savedProjectConfig.resources.length).toBe(0);

			// Verify global config is unchanged
			const savedGlobalConfig = JSON.parse(await fs.readFile(globalConfigPath, 'utf-8'));
			expect(savedGlobalConfig.provider).toBe('global-provider');
			expect(savedGlobalConfig.model).toBe('global-model');
		});

		it('mutations work correctly when only global config exists', async () => {
			// Create global config
			const globalConfigDir = path.join(testDir, '.config', 'btca');
			await fs.mkdir(globalConfigDir, { recursive: true });
			const globalConfig = {
				$schema: 'https://btca.dev/btca.schema.json',
				provider: 'global-provider',
				model: 'global-model',
				resources: [
					{
						name: 'svelte',
						type: 'git',
						url: 'https://github.com/sveltejs/svelte.dev',
						branch: 'main'
					}
				]
			};
			const globalConfigPath = path.join(globalConfigDir, 'btca.config.jsonc');
			await fs.writeFile(globalConfigPath, JSON.stringify(globalConfig));

			// Use a directory without project config
			const projectDir = path.join(testDir, 'my-project');
			await fs.mkdir(projectDir, { recursive: true });
			process.chdir(projectDir);

			const config = await Config.load();

			// Add a resource (should go to global)
			await config.addResource({
				name: 'new-resource',
				type: 'git',
				url: 'https://github.com/test/new-resource',
				branch: 'main'
			});

			expect(config.resources.length).toBe(2);

			// Verify global config was updated
			const savedGlobalConfig = JSON.parse(await fs.readFile(globalConfigPath, 'utf-8'));
			expect(savedGlobalConfig.resources.length).toBe(2);
			expect(savedGlobalConfig.resources.map((r: { name: string }) => r.name)).toEqual([
				'svelte',
				'new-resource'
			]);

			// Remove a resource (should work since we're in global-only mode)
			await config.removeResource('svelte');
			expect(config.resources.length).toBe(1);

			const savedGlobalConfig2 = JSON.parse(await fs.readFile(globalConfigPath, 'utf-8'));
			expect(savedGlobalConfig2.resources.length).toBe(1);
			expect(savedGlobalConfig2.resources[0].name).toBe('new-resource');
		});
	});
});
