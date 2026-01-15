import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Metrics } from '../../metrics/index.ts';
import { CommonHints } from '../../errors.ts';
import { ResourceError, resourceNameToKey } from '../helpers.ts';
import { GitResourceSchema } from '../schema.ts';
import type { BtcaFsResource, BtcaGitResourceArgs } from '../types.ts';

const validateGitUrl = (url: string): { success: true } | { success: false; error: string } => {
	const result = GitResourceSchema.shape.url.safeParse(url);
	if (result.success) return { success: true };
	return { success: false, error: result.error.errors[0]?.message ?? 'Invalid git URL' };
};

const validateBranch = (branch: string): { success: true } | { success: false; error: string } => {
	const result = GitResourceSchema.shape.branch.safeParse(branch);
	if (result.success) return { success: true };
	return { success: false, error: result.error.errors[0]?.message ?? 'Invalid branch name' };
};

const validateSearchPath = (
	searchPath: string
): { success: true } | { success: false; error: string } => {
	const result = GitResourceSchema.shape.searchPath.safeParse(searchPath);
	if (result.success) return { success: true };
	return { success: false, error: result.error.errors[0]?.message ?? 'Invalid search path' };
};

const directoryExists = async (path: string): Promise<boolean> => {
	try {
		const stat = await fs.stat(path);
		return stat.isDirectory();
	} catch {
		return false;
	}
};

/**
 * Git error patterns and their user-friendly messages.
 */
const GitErrorPatterns = {
	// Branch not found errors
	BRANCH_NOT_FOUND: [
		/couldn't find remote ref/i,
		/Remote branch .* not found/i,
		/fatal: invalid refspec/i,
		/error: pathspec .* did not match any/i
	],
	// Repository not found
	REPO_NOT_FOUND: [
		/Repository not found/i,
		/remote: Repository not found/i,
		/fatal: repository .* not found/i,
		/ERROR: Repository not found/i
	],
	// Authentication/Permission errors
	AUTH_REQUIRED: [
		/Authentication failed/i,
		/could not read Username/i,
		/Permission denied/i,
		/fatal: Authentication failed/i,
		/remote: HTTP Basic: Access denied/i,
		/The requested URL returned error: 403/i
	],
	// Network errors
	NETWORK_ERROR: [
		/Could not resolve host/i,
		/Connection refused/i,
		/Network is unreachable/i,
		/Unable to access/i,
		/Failed to connect/i,
		/Connection timed out/i,
		/SSL certificate problem/i
	],
	// Rate limiting
	RATE_LIMITED: [/rate limit exceeded/i, /too many requests/i, /API rate limit/i]
} as const;

type GitErrorType = keyof typeof GitErrorPatterns;

/**
 * Detect the type of git error from stderr output.
 */
const detectGitErrorType = (stderr: string): GitErrorType | null => {
	for (const [errorType, patterns] of Object.entries(GitErrorPatterns)) {
		for (const pattern of patterns) {
			if (pattern.test(stderr)) {
				return errorType as GitErrorType;
			}
		}
	}
	return null;
};

/**
 * Get a user-friendly error message and hint based on git error type.
 */
const getGitErrorDetails = (
	errorType: GitErrorType | null,
	context: { operation: string; branch?: string; url?: string; stderr?: string }
): { message: string; hint: string } => {
	const stderrSummary = context.stderr
		?.split('\n')
		.map((line) => line.trim())
		.find((line) => line.length > 0);

	switch (errorType) {
		case 'BRANCH_NOT_FOUND':
			return {
				message: context.branch
					? `Branch "${context.branch}" not found in the repository`
					: 'The specified branch was not found',
				hint: `${CommonHints.CHECK_BRANCH} You can check available branches at ${context.url ?? 'the repository URL'}.`
			};

		case 'REPO_NOT_FOUND':
			return {
				message: 'Repository not found',
				hint: `${CommonHints.CHECK_URL} If this is a private repository, ${CommonHints.CHECK_PERMISSIONS.toLowerCase()}`
			};

		case 'AUTH_REQUIRED':
			return {
				message: 'Authentication required or access denied',
				hint: CommonHints.CHECK_PERMISSIONS
			};

		case 'NETWORK_ERROR':
			return {
				message: `Network error during git ${context.operation}`,
				hint: CommonHints.CHECK_NETWORK
			};

		case 'RATE_LIMITED':
			return {
				message: 'Rate limit exceeded',
				hint: 'Wait a few minutes before trying again, or authenticate to increase your rate limit.'
			};

		default:
			return {
				message: stderrSummary
					? `git ${context.operation} failed: ${stderrSummary}`
					: `git ${context.operation} failed`,
				hint: `${CommonHints.CLEAR_CACHE} If the problem persists, verify your repository configuration.`
			};
	}
};

interface GitRunResult {
	exitCode: number;
	stderr: string;
}

interface GitpickRunResult {
	exitCode: number;
	stderr: string;
}

const runGit = async (
	args: string[],
	options: { cwd?: string; quiet: boolean }
): Promise<GitRunResult> => {
	// Always capture stderr for error detection, but stdout can be ignored
	const proc = Bun.spawn(['git', ...args], {
		cwd: options.cwd,
		stdout: options.quiet ? 'ignore' : 'inherit',
		stderr: 'pipe'
	});

	const stderrChunks: Uint8Array[] = [];
	const reader = proc.stderr.getReader();

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) stderrChunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const exitCode = await proc.exited;
	const totalLength = stderrChunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const combined = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of stderrChunks) {
		combined.set(chunk, offset);
		offset += chunk.length;
	}
	const stderr = new TextDecoder().decode(combined);

	// Log stderr to console if not quiet and there's content
	if (!options.quiet && stderr.trim()) {
		console.error(stderr);
	}

	return { exitCode, stderr };
};

const runGitpick = async (
	args: string[],
	options: { cwd?: string; quiet: boolean }
): Promise<GitpickRunResult> => {
	let proc: Bun.Subprocess;
	try {
		proc = Bun.spawn(['gitpick', ...args], {
			cwd: options.cwd,
			stdout: options.quiet ? 'ignore' : 'inherit',
			stderr: 'pipe'
		});
	} catch (cause) {
		throw new ResourceError({
			message: 'gitpick is not installed',
			hint: 'Install gitpick with "bun add -g gitpick" or remove cloneStrategy: "gitpick".',
			cause
		});
	}

	const stderrChunks: Uint8Array[] = [];
	const reader = proc.stderr.getReader();

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) stderrChunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const exitCode = await proc.exited;
	const totalLength = stderrChunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const combined = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of stderrChunks) {
		combined.set(chunk, offset);
		offset += chunk.length;
	}
	const stderr = new TextDecoder().decode(combined);

	if (!options.quiet && stderr.trim()) {
		console.error(stderr);
	}

	return { exitCode, stderr };
};

const gitClone = async (args: {
	repoUrl: string;
	repoBranch: string;
	repoSubPaths: readonly string[];
	localAbsolutePath: string;
	quiet: boolean;
}) => {
	const urlValidation = validateGitUrl(args.repoUrl);
	if (!urlValidation.success) {
		throw new ResourceError({
			message: urlValidation.error,
			hint: 'URLs must be valid HTTPS URLs. Example: https://github.com/user/repo',
			cause: new Error('URL validation failed')
		});
	}
	const branchValidation = validateBranch(args.repoBranch);
	if (!branchValidation.success) {
		throw new ResourceError({
			message: branchValidation.error,
			hint: 'Branch names can only contain letters, numbers, hyphens, underscores, dots, and forward slashes.',
			cause: new Error('Branch validation failed')
		});
	}
	for (const repoSubPath of args.repoSubPaths) {
		const pathValidation = validateSearchPath(repoSubPath);
		if (!pathValidation.success) {
			throw new ResourceError({
				message: pathValidation.error,
				hint: 'Search paths cannot contain ".." (path traversal) and must use only safe characters.',
				cause: new Error('Path validation failed')
			});
		}
	}

	const needsSparseCheckout = args.repoSubPaths.length > 0;
	const cloneArgs = needsSparseCheckout
		? [
				'clone',
				'--filter=blob:none',
				'--no-checkout',
				'--sparse',
				'-b',
				args.repoBranch,
				args.repoUrl,
				args.localAbsolutePath
			]
		: ['clone', '--depth', '1', '-b', args.repoBranch, args.repoUrl, args.localAbsolutePath];

	const result = await runGit(cloneArgs, { quiet: args.quiet });

	if (result.exitCode !== 0) {
		const errorType = detectGitErrorType(result.stderr);
		const { message, hint } = getGitErrorDetails(errorType, {
			operation: 'clone',
			branch: args.repoBranch,
			url: args.repoUrl,
			stderr: result.stderr
		});

		throw new ResourceError({
			message,
			hint,
			cause: new Error(`git clone failed with exit code ${result.exitCode}: ${result.stderr}`)
		});
	}

	if (needsSparseCheckout) {
		const sparseResult = await runGit(['sparse-checkout', 'set', ...args.repoSubPaths], {
			cwd: args.localAbsolutePath,
			quiet: args.quiet
		});

		if (sparseResult.exitCode !== 0) {
			throw new ResourceError({
				message: `Failed to set sparse-checkout path(s): "${args.repoSubPaths.join(', ')}"`,
				hint: 'Verify the search paths exist in the repository. Check the repository structure to find the correct path.',
				cause: new Error(
					`git sparse-checkout failed with exit code ${sparseResult.exitCode}: ${sparseResult.stderr}`
				)
			});
		}

		const checkoutResult = await runGit(['checkout'], {
			cwd: args.localAbsolutePath,
			quiet: args.quiet
		});

		if (checkoutResult.exitCode !== 0) {
			throw new ResourceError({
				message: 'Failed to checkout repository',
				hint: CommonHints.CLEAR_CACHE,
				cause: new Error(
					`git checkout failed with exit code ${checkoutResult.exitCode}: ${checkoutResult.stderr}`
				)
			});
		}
	}
};

const gitpickClone = async (args: {
	repoUrl: string;
	repoBranch: string;
	repoSubPaths: readonly string[];
	localAbsolutePath: string;
	quiet: boolean;
	overwrite: boolean;
}) => {
	if (!args.repoUrl.includes('github.com')) {
		throw new ResourceError({
			message: 'gitpick only supports GitHub repositories',
			hint: 'Use cloneStrategy: "git" for non-GitHub URLs.',
			cause: new Error('gitpick unsupported host')
		});
	}
	if (args.repoSubPaths.length > 0) {
		throw new ResourceError({
			message: 'gitpick does not support search paths in btca yet',
			hint: 'Remove searchPath/searchPaths or use cloneStrategy: "git".',
			cause: new Error('gitpick search path unsupported')
		});
	}

	const gitpickArgs = [
		args.repoUrl,
		args.localAbsolutePath,
		'-b',
		args.repoBranch,
		...(args.overwrite ? ['-o'] : [])
	];

	const result = await runGitpick(gitpickArgs, { quiet: args.quiet });
	if (result.exitCode !== 0) {
		const stderrSummary = result.stderr
			.split('\n')
			.map((line) => line.trim())
			.find((line) => line.length > 0);
		throw new ResourceError({
			message: stderrSummary ? `gitpick failed: ${stderrSummary}` : 'gitpick failed',
			hint: 'Check that the repository URL and branch are correct.',
			cause: new Error(`gitpick failed with exit code ${result.exitCode}: ${result.stderr}`)
		});
	}
};

const gitUpdate = async (args: {
	localAbsolutePath: string;
	branch: string;
	repoSubPaths: readonly string[];
	quiet: boolean;
	repoUrl: string;
}) => {
	const fetchResult = await runGit(['fetch', '--depth', '1', 'origin', args.branch], {
		cwd: args.localAbsolutePath,
		quiet: args.quiet
	});

	if (fetchResult.exitCode !== 0) {
		const errorType = detectGitErrorType(fetchResult.stderr);
		const { message, hint } = getGitErrorDetails(errorType, {
			operation: 'fetch',
			branch: args.branch,
			url: args.repoUrl,
			stderr: fetchResult.stderr
		});

		throw new ResourceError({
			message,
			hint,
			cause: new Error(
				`git fetch failed with exit code ${fetchResult.exitCode}: ${fetchResult.stderr}`
			)
		});
	}

	const resetResult = await runGit(['reset', '--hard', `origin/${args.branch}`], {
		cwd: args.localAbsolutePath,
		quiet: args.quiet
	});

	if (resetResult.exitCode !== 0) {
		throw new ResourceError({
			message: 'Failed to update local repository',
			hint: `${CommonHints.CLEAR_CACHE} This will re-clone the repository from scratch.`,
			cause: new Error(
				`git reset failed with exit code ${resetResult.exitCode}: ${resetResult.stderr}`
			)
		});
	}

	if (args.repoSubPaths.length > 0) {
		const sparseResult = await runGit(['sparse-checkout', 'set', ...args.repoSubPaths], {
			cwd: args.localAbsolutePath,
			quiet: args.quiet
		});

		if (sparseResult.exitCode !== 0) {
			throw new ResourceError({
				message: `Failed to set sparse-checkout path(s): "${args.repoSubPaths.join(', ')}"`,
				hint: 'Verify the search paths exist in the repository. Check the repository structure to find the correct path.',
				cause: new Error(
					`git sparse-checkout failed with exit code ${sparseResult.exitCode}: ${sparseResult.stderr}`
				)
			});
		}

		const checkoutResult = await runGit(['checkout'], {
			cwd: args.localAbsolutePath,
			quiet: args.quiet
		});

		if (checkoutResult.exitCode !== 0) {
			throw new ResourceError({
				message: 'Failed to checkout repository',
				hint: CommonHints.CLEAR_CACHE,
				cause: new Error(
					`git checkout failed with exit code ${checkoutResult.exitCode}: ${checkoutResult.stderr}`
				)
			});
		}
	}
};

const ensureSearchPathsExist = async (
	localPath: string,
	repoSubPaths: readonly string[]
): Promise<void> => {
	for (const repoSubPath of repoSubPaths) {
		const subPath = path.join(localPath, repoSubPath);
		const exists = await directoryExists(subPath);
		if (!exists) {
			throw new ResourceError({
				message: `Search path does not exist: "${repoSubPath}"`,
				hint: 'Check the repository structure and update the search path in your btca config.',
				cause: new Error(`Missing search path: ${repoSubPath}`)
			});
		}
	}
};

const ensureGitResource = async (config: BtcaGitResourceArgs): Promise<string> => {
	const resourceKey = resourceNameToKey(config.name);
	const localPath = path.join(config.resourcesDirectoryPath, resourceKey);
	const cloneStrategy = config.cloneStrategy ?? 'git';

	return Metrics.span(
		'resource.git.ensure',
		async () => {
			const exists = await directoryExists(localPath);

			if (exists) {
				Metrics.info('resource.git.update', {
					name: config.name,
					branch: config.branch,
					repoSubPaths: config.repoSubPaths,
					cloneStrategy
				});
				if (cloneStrategy === 'gitpick') {
					await gitpickClone({
						repoUrl: config.url,
						repoBranch: config.branch,
						repoSubPaths: config.repoSubPaths,
						localAbsolutePath: localPath,
						quiet: config.quiet,
						overwrite: true
					});
				} else {
					await gitUpdate({
						localAbsolutePath: localPath,
						branch: config.branch,
						repoSubPaths: config.repoSubPaths,
						quiet: config.quiet,
						repoUrl: config.url
					});
					if (config.repoSubPaths.length > 0) {
						await ensureSearchPathsExist(localPath, config.repoSubPaths);
					}
				}
				return localPath;
			}

			Metrics.info('resource.git.clone', {
				name: config.name,
				branch: config.branch,
				repoSubPaths: config.repoSubPaths,
				cloneStrategy
			});

			try {
				await fs.mkdir(config.resourcesDirectoryPath, { recursive: true });
			} catch (cause) {
				throw new ResourceError({
					message: 'Failed to create resources directory',
					hint: 'Check that you have write permissions to the btca data directory.',
					cause
				});
			}

			if (cloneStrategy === 'gitpick') {
				await gitpickClone({
					repoUrl: config.url,
					repoBranch: config.branch,
					repoSubPaths: config.repoSubPaths,
					localAbsolutePath: localPath,
					quiet: config.quiet,
					overwrite: false
				});
			} else {
				await gitClone({
					repoUrl: config.url,
					repoBranch: config.branch,
					repoSubPaths: config.repoSubPaths,
					localAbsolutePath: localPath,
					quiet: config.quiet
				});
				if (config.repoSubPaths.length > 0) {
					await ensureSearchPathsExist(localPath, config.repoSubPaths);
				}
			}

			return localPath;
		},
		{ resource: config.name }
	);
};

export const loadGitResource = async (config: BtcaGitResourceArgs): Promise<BtcaFsResource> => {
	const localPath = await ensureGitResource(config);
	return {
		_tag: 'fs-based',
		name: config.name,
		fsName: resourceNameToKey(config.name),
		type: 'git',
		repoSubPaths: config.repoSubPaths,
		specialAgentInstructions: config.specialAgentInstructions,
		getAbsoluteDirectoryPath: async () => localPath
	};
};
