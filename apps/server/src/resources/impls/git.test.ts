import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { loadGitResource, syncSparseCheckoutPaths } from './git.ts';
import type { BtcaGitResourceArgs } from '../types.ts';

const runGit = async (
	args: string[],
	options: { cwd?: string; env?: Record<string, string> } = {}
) => {
	const proc = Bun.spawn(['git', ...args], {
		cwd: options.cwd,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'btca-test',
			GIT_AUTHOR_EMAIL: 'btca-test@example.com',
			GIT_COMMITTER_NAME: 'btca-test',
			GIT_COMMITTER_EMAIL: 'btca-test@example.com',
			...(options.env ?? {})
		},
		stdout: 'pipe',
		stderr: 'pipe'
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		throw new Error(`git ${args.join(' ')} failed (${exitCode}): ${stderr}`);
	}

	return { stdout, stderr };
};

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

		it('supports sparse checkout updates for submodule-backed search paths', async () => {
			const childRepo = path.join(testDir, 'child-repo');
			const childBareRepo = path.join(testDir, 'child-repo.git');
			const parentRepo = path.join(testDir, 'parent-repo');
			const cloneRepo = path.join(testDir, 'clone-repo');

			await fs.mkdir(childRepo, { recursive: true });
			await runGit(['init', '-b', 'main'], { cwd: childRepo });
			await fs.writeFile(path.join(childRepo, 'README.md'), '# child\n');
			await runGit(['add', 'README.md'], { cwd: childRepo });
			await runGit(['commit', '-m', 'init child'], { cwd: childRepo });
			await runGit(['clone', '--bare', childRepo, childBareRepo]);

			await fs.mkdir(parentRepo, { recursive: true });
			await runGit(['init', '-b', 'main'], { cwd: parentRepo });
			await fs.writeFile(path.join(parentRepo, 'README.md'), '# parent\n');
			await runGit(['add', 'README.md'], { cwd: parentRepo });
			await runGit(['commit', '-m', 'init parent'], { cwd: parentRepo });
			await runGit(
				[
					'-c',
					'protocol.file.allow=always',
					'submodule',
					'add',
					childBareRepo,
					'chipwhisperer-minimal'
				],
				{ cwd: parentRepo }
			);
			await runGit(['commit', '-am', 'add submodule'], { cwd: parentRepo });

			await runGit(['clone', '--no-checkout', '--sparse', '-b', 'main', parentRepo, cloneRepo]);

			await syncSparseCheckoutPaths({
				localAbsolutePath: cloneRepo,
				repoSubPaths: ['chipwhisperer-minimal'],
				quiet: true
			});

			const firstStat = await fs.stat(path.join(cloneRepo, 'chipwhisperer-minimal'));
			expect(firstStat.isDirectory()).toBe(true);

			await runGit(['fetch', '--depth', '1', 'origin', 'main'], { cwd: cloneRepo });
			await runGit(['reset', '--hard', 'origin/main'], { cwd: cloneRepo });

			await syncSparseCheckoutPaths({
				localAbsolutePath: cloneRepo,
				repoSubPaths: ['chipwhisperer-minimal'],
				quiet: true
			});

			const secondStat = await fs.stat(path.join(cloneRepo, 'chipwhisperer-minimal'));
			expect(secondStat.isDirectory()).toBe(true);
		});
	});
});
