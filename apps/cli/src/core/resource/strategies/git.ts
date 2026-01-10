import { FileSystem } from '@effect/platform';
import { Effect } from 'effect';
import type { GitResource } from '../types.ts';
import { ResourceError } from '../errors.ts';
import { directoryExists } from '../../../lib/utils/files.ts';
import {
	validateBranchName,
	validateGitUrl,
	validateSearchPath
} from '../../validation/resource.ts';

/** Run a git command, fails with ResourceError if non-zero exit */
const runGit = (args: string[], options: { cwd?: string; quiet?: boolean }) =>
	Effect.tryPromise({
		try: async () => {
			const stdio = options.quiet ? 'ignore' : 'inherit';
			const proc = Bun.spawn(['git', ...args], {
				cwd: options.cwd,
				stdout: stdio,
				stderr: stdio
			});
			const exitCode = await proc.exited;
			if (exitCode !== 0) {
				throw new Error(`git ${args[0]} failed with exit code ${exitCode}`);
			}
		},
		catch: (error) => new ResourceError({ message: `git ${args[0]} failed`, cause: error })
	}).pipe(
		Effect.tapError(() =>
			Effect.sync(() => {
				console.log(
					'\nHint: If git operations are failing, try running "btca clear" to reset cached resources and try again.'
				);
			})
		)
	);

/** Write sparse checkout config */
const writeSparseCheckout = (repoDir: string, searchPath: string) =>
	Effect.tryPromise({
		try: () => Bun.write(`${repoDir}/.git/info/sparse-checkout`, `${searchPath}/*\n`),
		catch: (error) =>
			new ResourceError({ message: 'Failed to write sparse-checkout', cause: error })
	});

/** Clone a git repo with sparse checkout */
const cloneRepo = (args: {
	repoDir: string;
	url: string;
	branch: string;
	searchPath?: string;
	quiet?: boolean;
}) =>
	Effect.gen(function* () {
		const { repoDir, url, branch, searchPath, quiet } = args;
		const fs = yield* FileSystem.FileSystem;

		yield* fs.makeDirectory(repoDir, { recursive: true });

		const normalizedUrl = yield* validateGitUrl(url);
		yield* validateBranchName(branch);
		if (searchPath) {
			yield* validateSearchPath(searchPath);
		}

		// Use '--' delimiter to prevent git option injection
		yield* runGit(['init', '--', repoDir], { quiet });
		yield* runGit(['remote', 'add', 'origin', '--', normalizedUrl], { cwd: repoDir, quiet });

		if (searchPath) {
			yield* runGit(['config', 'core.sparseCheckout', 'true'], { cwd: repoDir, quiet });
			yield* writeSparseCheckout(repoDir, searchPath);
		}

		yield* runGit(['fetch', '--depth', '1', 'origin', branch], { cwd: repoDir, quiet });
		yield* runGit(['checkout', branch], { cwd: repoDir, quiet });
	});

/** Pull latest changes for a git repo */
const pullRepo = (args: { repoDir: string; branch: string; quiet?: boolean }) =>
	Effect.gen(function* () {
		const { repoDir, branch, quiet } = args;

		// Validate branch name to prevent injection attacks
		yield* validateBranchName(branch);

		yield* runGit(['fetch', '--depth', '1', 'origin', branch], { cwd: repoDir, quiet });
		yield* runGit(['reset', '--hard', `origin/${branch}`], { cwd: repoDir, quiet });
	});

/**
 * Ensure a git resource is cached locally.
 * Clones if not present, pulls if already present.
 */
export const ensureGitResource = (args: {
	resource: GitResource;
	resourcesDir: string;
	quiet?: boolean;
}) =>
	Effect.gen(function* () {
		const { resource, resourcesDir, quiet = false } = args;
		const repoDir = `${resourcesDir}/${resource.name}`;

		const exists = yield* directoryExists(repoDir).pipe(
			Effect.mapError((e) => new ResourceError({ message: e.message, cause: e }))
		);

		if (exists) {
			if (!quiet) yield* Effect.log(`Updating ${resource.name}...`);
			yield* pullRepo({ repoDir, branch: resource.branch, quiet });
		} else {
			if (!quiet) yield* Effect.log(`Cloning ${resource.name}...`);
			yield* cloneRepo({
				repoDir,
				url: resource.url,
				branch: resource.branch,
				searchPath: resource.searchPath,
				quiet
			});
		}

		return {
			name: resource.name,
			type: 'git' as const,
			specialNotes: resource.specialNotes,
			searchPath: resource.searchPath
		};
	});

/**
 * Check if a git resource is cached
 */
export const isGitResourceCached = (args: {
	resource: GitResource;
	resourcesDir: string;
}): Effect.Effect<boolean, ResourceError, FileSystem.FileSystem> =>
	directoryExists(`${args.resourcesDir}/${args.resource.name}`).pipe(
		Effect.mapError((e) => new ResourceError({ message: e.message, cause: e }))
	);
