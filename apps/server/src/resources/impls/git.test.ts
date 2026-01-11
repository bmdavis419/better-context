import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { loadGitResource } from './git.ts';
import type { BtcaGitResourceArgs } from '../types.ts';

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
					repoSubPath: 'docs',
					resourcesDirectoryPath: testDir,
					specialAgentInstructions: 'Test notes',
					quiet: true
				};

				const resource = await loadGitResource(args);

				expect(resource._tag).toBe('fs-based');
				expect(resource.name).toBe('test-repo');
				expect(resource.type).toBe('git');
				expect(resource.repoSubPath).toBe('docs');
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
					repoSubPath: '',
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
				repoSubPath: '',
				resourcesDirectoryPath: testDir,
				specialAgentInstructions: '',
				quiet: true
			};

			expect(loadGitResource(args)).rejects.toThrow('Invalid git URL');
		});

		it('throws error for invalid branch name', async () => {
			const args: BtcaGitResourceArgs = {
				type: 'git',
				name: 'invalid-branch',
				url: 'https://github.com/test/repo',
				branch: 'invalid branch name!',
				repoSubPath: '',
				resourcesDirectoryPath: testDir,
				specialAgentInstructions: '',
				quiet: true
			};

			expect(loadGitResource(args)).rejects.toThrow('Invalid branch name');
		});

		it('throws error for path traversal attempt', async () => {
			const args: BtcaGitResourceArgs = {
				type: 'git',
				name: 'path-traversal',
				url: 'https://github.com/test/repo',
				branch: 'main',
				repoSubPath: '../../../etc',
				resourcesDirectoryPath: testDir,
				specialAgentInstructions: '',
				quiet: true
			};

			expect(loadGitResource(args)).rejects.toThrow('Invalid path');
		});
	});
});
