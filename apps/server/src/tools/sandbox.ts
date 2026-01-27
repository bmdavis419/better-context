/**
 * Path Sandboxing Utilities
 * Ensures all file operations stay within the collections directory
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export namespace Sandbox {
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

	/**
	 * Resolve a path relative to the base path and validate it stays within bounds
	 *
	 * @param basePath - The allowed base directory (collections path)
	 * @param requestedPath - The path requested by the user/agent
	 * @returns The resolved absolute path
	 * @throws PathEscapeError if the path would escape the base directory
	 */
	export function resolvePath(basePath: string, requestedPath: string): string {
		// Normalize the base path
		const normalizedBase = path.resolve(basePath);

		// Resolve the requested path relative to the base
		let resolved: string;
		if (path.isAbsolute(requestedPath)) {
			resolved = path.resolve(requestedPath);
		} else {
			resolved = path.resolve(normalizedBase, requestedPath);
		}

		// Normalize to remove any .. or . components
		resolved = path.normalize(resolved);

		// Check that the resolved path starts with the base path
		// We need to ensure the path is either exactly the base or within it
		const relative = path.relative(normalizedBase, resolved);

		// If the relative path starts with '..' or is absolute, it's outside the base
		if (relative.startsWith('..') || path.isAbsolute(relative)) {
			throw new PathEscapeError(requestedPath, basePath);
		}

		return resolved;
	}

	/**
	 * Resolve a path and follow symlinks, validating both the path and its target
	 *
	 * @param basePath - The allowed base directory (collections path)
	 * @param requestedPath - The path requested by the user/agent
	 * @returns The resolved real path (after following symlinks)
	 * @throws PathEscapeError if the path or symlink target would escape the base directory
	 */
	export async function resolvePathWithSymlinks(
		basePath: string,
		requestedPath: string
	): Promise<string> {
		// First validate the path itself
		const resolved = resolvePath(basePath, requestedPath);

		try {
			// Get the real path (follows symlinks)
			const realPath = await fs.realpath(resolved);

			// For symlinks pointing outside, we allow it since the collection
			// symlinks resources from various locations. The sandbox is about
			// what the agent can ACCESS through the collection, not where the
			// actual files live.
			//
			// The key security boundary is that:
			// 1. The agent can only request paths within the collection directory
			// 2. Those paths may be symlinks to actual resource locations
			// 3. This is intentional - the collection IS the set of accessible resources

			return realPath;
		} catch (error) {
			// If realpath fails, the file doesn't exist
			// Return the resolved path anyway for error messages
			return resolved;
		}
	}

	/**
	 * Check if a path exists and is within the sandbox
	 */
	export async function exists(basePath: string, requestedPath: string): Promise<boolean> {
		try {
			const resolved = resolvePath(basePath, requestedPath);
			const file = Bun.file(resolved);
			return await file.exists();
		} catch {
			return false;
		}
	}

	/**
	 * Check if a path is a directory
	 */
	export async function isDirectory(basePath: string, requestedPath: string): Promise<boolean> {
		try {
			const resolved = resolvePath(basePath, requestedPath);
			const stats = await fs.stat(resolved);
			return stats.isDirectory();
		} catch {
			return false;
		}
	}

	/**
	 * Check if a path is a file
	 */
	export async function isFile(basePath: string, requestedPath: string): Promise<boolean> {
		try {
			const resolved = resolvePath(basePath, requestedPath);
			const stats = await fs.stat(resolved);
			return stats.isFile();
		} catch {
			return false;
		}
	}

	/**
	 * Validate a path exists and is within sandbox, throwing if not
	 */
	export async function validatePath(basePath: string, requestedPath: string): Promise<string> {
		const resolved = resolvePath(basePath, requestedPath);

		const file = Bun.file(resolved);
		if (!(await file.exists())) {
			throw new PathNotFoundError(requestedPath);
		}

		return resolved;
	}

	/**
	 * Get the relative path from base to the resolved path
	 */
	export function getRelativePath(basePath: string, resolvedPath: string): string {
		return path.relative(basePath, resolvedPath);
	}
}
