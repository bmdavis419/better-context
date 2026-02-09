import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { loadGitResource } from './git.ts';
import { GitResourceSchema } from '../schema.ts';
import type { BtcaGitResourceArgs } from '../types.ts';

describe('Branch name validation', () => {
	const validGitResource = (branch: string) => ({
		type: 'git' as const,
		name: 'test',
		url: 'https://github.com/test/repo',
		branch
	});

	it('accepts monorepo-style scoped tags', () => {
		const result = GitResourceSchema.safeParse(validGitResource('@chakra-ui/react@2.8.2'));
		expect(result.success).toBe(true);
	});

	it('accepts simple version tags', () => {
		const result = GitResourceSchema.safeParse(validGitResource('v18.2.0'));
		expect(result.success).toBe(true);
	});

	it('accepts standard branch names', () => {
		const result = GitResourceSchema.safeParse(validGitResource('feature/my-branch'));
		expect(result.success).toBe(true);
	});

	it('rejects branch names starting with hyphen', () => {
		const result = GitResourceSchema.safeParse(validGitResource('-dangerous'));
		expect(result.success).toBe(false);
	});

	it('rejects branch names with spaces', () => {
		const result = GitResourceSchema.safeParse(validGitResource('my branch'));
		expect(result.success).toBe(false);
	});

	it('rejects branch names with special characters', () => {
		const result = GitResourceSchema.safeParse(validGitResource('branch;rm -rf'));
		expect(result.success).toBe(false);
	});
});

describe('Git Resource', () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'btca-git-test-'));
	});

	afterEach(async () => {
		await fs.rm(testDir, { recursive: true, force: true });
	});

	describe('loadGitResource', () => {
		describe.skipIf(!process.env.BTCA_RUN_INTEGRATION_TESTS)('integration (network)', () => {
			it('clones a git repository', async () => {
				const args: BtcaGitResourceArgs = {
					type: 'git',
					name: 'test-repo',
					url: 'https://github.com/honojs/hono',
					branch: 'main',
					repoSubPaths: ['docs'],
					resourcesDirectoryPath: testDir,
					specialAgentInstructions: 'Test notes',
					quiet: true
				};

				const resource = await loadGitResource(args);

				expect(resource._tag).toBe('fs-based');
				expect(resource.name).toBe('test-repo');
				expect(resource.type).toBe('git');
				expect(resource.repoSubPaths).toEqual(['docs']);
				expect(resource.specialAgentInstructions).toBe('Test notes');

				const resourcePath = await resource.getAbsoluteDirectoryPath();
				expect(resourcePath).toBe(path.join(testDir, 'test-repo'));

				const stat = await fs.stat(resourcePath);
				expect(stat.isDirectory()).toBe(true);

				const gitDir = await fs.stat(path.join(resourcePath, '.git'));
				expect(gitDir.isDirectory()).toBe(true);
			}, 30000);

			it('updates an existing git repository', async () => {
				const args: BtcaGitResourceArgs = {
					type: 'git',
					name: 'update-test',
					url: 'https://github.com/honojs/hono',
					branch: 'main',
					repoSubPaths: [],
					resourcesDirectoryPath: testDir,
					specialAgentInstructions: '',
					quiet: true
				};

				await loadGitResource(args);
				const resource = await loadGitResource(args);

				expect(resource.name).toBe('update-test');
				const resourcePath = await resource.getAbsoluteDirectoryPath();
				const stat = await fs.stat(resourcePath);
				expect(stat.isDirectory()).toBe(true);
			}, 60000);
		});

		it('throws error for invalid git URL', async () => {
			const args: BtcaGitResourceArgs = {
				type: 'git',
				name: 'invalid-url',
				url: 'not-a-valid-url',
				branch: 'main',
				repoSubPaths: [],
				resourcesDirectoryPath: testDir,
				specialAgentInstructions: '',
				quiet: true
			};

			expect(loadGitResource(args)).rejects.toThrow('Git URL must be a valid HTTPS URL');
		});

		it('throws error for invalid branch name', async () => {
			const args: BtcaGitResourceArgs = {
				type: 'git',
				name: 'invalid-branch',
				url: 'https://github.com/test/repo',
				branch: 'invalid branch name!',
				repoSubPaths: [],
				resourcesDirectoryPath: testDir,
				specialAgentInstructions: '',
				quiet: true
			};

			expect(loadGitResource(args)).rejects.toThrow('Branch name must contain only');
		});

		it('throws error for branch name starting with hyphen', async () => {
			const args: BtcaGitResourceArgs = {
				type: 'git',
				name: 'hyphen-branch',
				url: 'https://github.com/test/repo',
				branch: '-dangerous',
				repoSubPaths: [],
				resourcesDirectoryPath: testDir,
				specialAgentInstructions: '',
				quiet: true
			};

			expect(loadGitResource(args)).rejects.toThrow("must not start with '-'");
		});

		it('throws error for branch name with spaces', async () => {
			const args: BtcaGitResourceArgs = {
				type: 'git',
				name: 'space-branch',
				url: 'https://github.com/test/repo',
				branch: 'my branch',
				repoSubPaths: [],
				resourcesDirectoryPath: testDir,
				specialAgentInstructions: '',
				quiet: true
			};

			expect(loadGitResource(args)).rejects.toThrow('Branch name must contain only');
		});

		it('throws error for path traversal attempt', async () => {
			const args: BtcaGitResourceArgs = {
				type: 'git',
				name: 'path-traversal',
				url: 'https://github.com/test/repo',
				branch: 'main',
				repoSubPaths: ['../../../etc'],
				resourcesDirectoryPath: testDir,
				specialAgentInstructions: '',
				quiet: true
			};

			expect(loadGitResource(args)).rejects.toThrow('path traversal');
		});
	});
});
