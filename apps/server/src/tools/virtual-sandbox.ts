import * as path from 'node:path';

import { Result } from 'better-result';

import { VirtualFs } from '../vfs/virtual-fs.ts';

const posix = path.posix;

export namespace VirtualSandbox {
	export class PathEscapeError extends Error {
		readonly _tag = 'PathEscapeError';
		readonly requestedPath: string;
		readonly basePath: string;

		constructor(requestedPath: string, basePath: string) {
			super(
				`Path "${requestedPath}" is outside the allowed directory "${basePath}". Access denied.`
			);
			this.requestedPath = requestedPath;
			this.basePath = basePath;
		}
	}

	export class PathNotFoundError extends Error {
		readonly _tag = 'PathNotFoundError';
		readonly requestedPath: string;

		constructor(requestedPath: string) {
			super(`Path "${requestedPath}" does not exist.`);
			this.requestedPath = requestedPath;
		}
	}

	export function resolvePath(basePath: string, requestedPath: string): string {
		const normalizedBase = posix.resolve('/', basePath);
		const resolved = posix.isAbsolute(requestedPath)
			? posix.resolve(requestedPath)
			: posix.resolve(normalizedBase, requestedPath);
		const normalized = posix.normalize(resolved);
		const relative = posix.relative(normalizedBase, normalized);

		if (relative.startsWith('..') || posix.isAbsolute(relative)) {
			throw new PathEscapeError(requestedPath, basePath);
		}

		return normalized;
	}

	export async function resolvePathWithSymlinks(
		basePath: string,
		requestedPath: string,
		vfsId?: string
	) {
		const resolved = resolvePath(basePath, requestedPath);
		const result = await Result.tryPromise(() => VirtualFs.realpath(resolved, vfsId));
		return result.match({
			ok: (value) => value,
			err: () => resolved
		});
	}

	export async function exists(basePath: string, requestedPath: string, vfsId?: string) {
		const resolvedResult = Result.try(() => resolvePath(basePath, requestedPath));
		if (!Result.isOk(resolvedResult)) return false;
		const result = await Result.tryPromise(() => VirtualFs.exists(resolvedResult.value, vfsId));
		return result.match({
			ok: (value) => value,
			err: () => false
		});
	}

	export async function isDirectory(basePath: string, requestedPath: string, vfsId?: string) {
		const resolvedResult = Result.try(() => resolvePath(basePath, requestedPath));
		if (!Result.isOk(resolvedResult)) return false;
		const result = await Result.tryPromise(() => VirtualFs.stat(resolvedResult.value, vfsId));
		return result.match({
			ok: (stats) => stats.isDirectory,
			err: () => false
		});
	}

	export async function isFile(basePath: string, requestedPath: string, vfsId?: string) {
		const resolvedResult = Result.try(() => resolvePath(basePath, requestedPath));
		if (!Result.isOk(resolvedResult)) return false;
		const result = await Result.tryPromise(() => VirtualFs.stat(resolvedResult.value, vfsId));
		return result.match({
			ok: (stats) => stats.isFile,
			err: () => false
		});
	}

	export async function validatePath(basePath: string, requestedPath: string, vfsId?: string) {
		const resolved = resolvePath(basePath, requestedPath);
		if (!(await VirtualFs.exists(resolved, vfsId))) {
			throw new PathNotFoundError(requestedPath);
		}
		return resolved;
	}

	export function getRelativePath(basePath: string, resolvedPath: string): string {
		return posix.relative(basePath, resolvedPath);
	}
}
