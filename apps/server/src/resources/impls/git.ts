import { promises as fs } from 'node:fs';

import { Metrics } from '../../metrics/index.ts';
import { ResourceError } from '../helpers.ts';
import type { BtcaFsResource, BtcaGitResourceArgs } from '../types.ts';

const isValidGitUrl = (url: string) => /^https?:\/\//.test(url) || /^git@/.test(url);
const isValidBranch = (branch: string) => /^[\w\-./]+$/.test(branch);
const isValidPath = (path: string) => !path.includes('..') && /^[\w\-./]*$/.test(path);

const directoryExists = async (path: string): Promise<boolean> => {
	try {
		const stat = await fs.stat(path);
		return stat.isDirectory();
	} catch {
		return false;
	}
};

const runGit = async (args: string[], options: { cwd?: string; quiet: boolean }) => {
	const stdio = options.quiet ? 'ignore' : 'inherit';
	const proc = Bun.spawn(['git', ...args], {
		cwd: options.cwd,
		stdout: stdio,
		stderr: stdio
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new ResourceError({
			message: `git ${args[0]} failed`,
			cause: new Error(String(exitCode))
		});
	}
};

const gitClone = async (args: {
	repoUrl: string;
	repoBranch: string;
	repoSubPath: string;
	localAbsolutePath: string;
	quiet: boolean;
}) => {
	if (!isValidGitUrl(args.repoUrl)) {
		throw new ResourceError({
			message: 'Invalid git URL',
			cause: new Error('URL validation failed')
		});
	}
	if (!isValidBranch(args.repoBranch)) {
		throw new ResourceError({
			message: 'Invalid branch name',
			cause: new Error('Branch validation failed')
		});
	}
	if (args.repoSubPath && !isValidPath(args.repoSubPath)) {
		throw new ResourceError({
			message: 'Invalid path',
			cause: new Error('Path validation failed')
		});
	}

	const needsSparseCheckout = args.repoSubPath && args.repoSubPath !== '/';
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

	await runGit(cloneArgs, { quiet: args.quiet });

	if (needsSparseCheckout) {
		await runGit(['sparse-checkout', 'set', args.repoSubPath], {
			cwd: args.localAbsolutePath,
			quiet: args.quiet
		});
		await runGit(['checkout'], { cwd: args.localAbsolutePath, quiet: args.quiet });
	}
};

const gitUpdate = async (args: { localAbsolutePath: string; branch: string; quiet: boolean }) => {
	await runGit(['fetch', '--depth', '1', 'origin', args.branch], {
		cwd: args.localAbsolutePath,
		quiet: args.quiet
	});
	await runGit(['reset', '--hard', `origin/${args.branch}`], {
		cwd: args.localAbsolutePath,
		quiet: args.quiet
	});
};

const ensureGitResource = async (config: BtcaGitResourceArgs): Promise<string> => {
	const localPath = `${config.resourcesDirectoryPath}/${config.name}`;

	return Metrics.span(
		'resource.git.ensure',
		async () => {
			const exists = await directoryExists(localPath);

			if (exists) {
				Metrics.info('resource.git.update', {
					name: config.name,
					branch: config.branch,
					repoSubPath: config.repoSubPath
				});
				await gitUpdate({
					localAbsolutePath: localPath,
					branch: config.branch,
					quiet: config.quiet
				});
				return localPath;
			}

			Metrics.info('resource.git.clone', {
				name: config.name,
				branch: config.branch,
				repoSubPath: config.repoSubPath
			});

			try {
				await fs.mkdir(config.resourcesDirectoryPath, { recursive: true });
			} catch (cause) {
				throw new ResourceError({ message: 'Failed to create resources directory', cause });
			}

			await gitClone({
				repoUrl: config.url,
				repoBranch: config.branch,
				repoSubPath: config.repoSubPath,
				localAbsolutePath: localPath,
				quiet: config.quiet
			});

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
		type: 'git',
		repoSubPath: config.repoSubPath,
		specialAgentInstructions: config.specialAgentInstructions,
		getAbsoluteDirectoryPath: async () => localPath
	};
};
