import { Effect } from 'effect';
import { ConfigError } from '../errors';

export const cloneRepo = (args: {
	repoDir: string;
	url: string;
	branch: string;
	quiet?: boolean;
}) =>
	Effect.tryPromise({
		try: async () => {
			const { repoDir, url, branch, quiet } = args;
			const proc = Bun.spawn(['git', 'clone', '--branch', branch, url, repoDir], {
				stdout: quiet ? 'ignore' : 'inherit',
				stderr: quiet ? 'ignore' : 'inherit'
			});
			const exitCode = await proc.exited;
			if (exitCode !== 0) {
				throw new Error(`git clone failed with exit code ${exitCode}`);
			}
		},
		catch: (error) => new ConfigError({ message: 'Failed to clone repo', cause: error })
	});

export const pullRepo = (args: { repoDir: string; branch: string; quiet?: boolean }) =>
	Effect.tryPromise({
		try: async () => {
			const { repoDir, branch, quiet } = args;
			const proc = Bun.spawn(['git', 'pull', 'origin', branch], {
				cwd: repoDir,
				stdout: quiet ? 'ignore' : 'inherit',
				stderr: quiet ? 'ignore' : 'inherit'
			});
			const exitCode = await proc.exited;
			if (exitCode !== 0) {
				throw new Error(`git pull failed with exit code ${exitCode}`);
			}
		},
		catch: (error) => new ConfigError({ message: 'Failed to pull repo', cause: error })
	});
