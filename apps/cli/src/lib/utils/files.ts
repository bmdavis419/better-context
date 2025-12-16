import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import { ConfigError } from '../errors.ts';

export const expandHome = (filePath: string): Effect.Effect<string, never, Path.Path> =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
			const homeDir = Bun.env.HOME ?? Bun.env.USERPROFILE ?? '';
			return path.join(homeDir, filePath.slice(2));
		}
		return filePath;
	});

export const directoryExists = (dir: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const exists = yield* fs.exists(dir);
		if (!exists) return false;
		const stat = yield* fs.stat(dir);
		return stat.type === 'Directory';
	}).pipe(
		Effect.catchAll((error) =>
			Effect.fail(
				new ConfigError({
					message: 'Failed to check directory',
					cause: error
				})
			)
		)
	);

export const ensureDirectory = (dir: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const exists = yield* fs.exists(dir);
		if (!exists) {
			yield* fs.makeDirectory(dir, { recursive: true });
		}
	}).pipe(
		Effect.catchAll((error) =>
			Effect.fail(
				new ConfigError({
					message: 'Failed to create directory',
					cause: error
				})
			)
		)
	);
