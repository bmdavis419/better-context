/**
 * List Tool
 * Lists directory contents with file types
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';

import { Sandbox } from './sandbox.ts';

export namespace ListTool {
	// Schema for tool parameters
	export const Parameters = z.object({
		path: z.string().describe('The directory path to list')
	});

	export type ParametersType = z.infer<typeof Parameters>;

	// Entry type
	export type Entry = {
		name: string;
		type: 'file' | 'directory' | 'symlink' | 'other';
		size?: number;
	};

	// Result type
	export type Result = {
		title: string;
		output: string;
		metadata: {
			entries: Entry[];
			fileCount: number;
			directoryCount: number;
		};
	};

	/**
	 * Execute the list tool
	 */
	export async function execute(
		params: ParametersType,
		context: { basePath: string }
	): Promise<Result> {
		const { basePath } = context;

		// Resolve path within sandbox
		const resolvedPath = Sandbox.resolvePath(basePath, params.path);

		// Check if path exists
		try {
			const stats = await fs.stat(resolvedPath);
			if (!stats.isDirectory()) {
				return {
					title: params.path,
					output: `Path is not a directory: ${params.path}`,
					metadata: {
						entries: [],
						fileCount: 0,
						directoryCount: 0
					}
				};
			}
		} catch {
			return {
				title: params.path,
				output: `Directory not found: ${params.path}`,
				metadata: {
					entries: [],
					fileCount: 0,
					directoryCount: 0
				}
			};
		}

		// Read directory contents
		const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });

		// Process entries
		const entries: Entry[] = [];

		for (const dirent of dirents) {
			let type: Entry['type'] = 'other';
			let size: number | undefined;

			if (dirent.isDirectory()) {
				type = 'directory';
			} else if (dirent.isFile()) {
				type = 'file';
				try {
					const stats = await fs.stat(path.join(resolvedPath, dirent.name));
					size = stats.size;
				} catch {
					// Ignore stat errors
				}
			} else if (dirent.isSymbolicLink()) {
				type = 'symlink';
				// Try to determine if symlink points to file or directory
				try {
					const stats = await fs.stat(path.join(resolvedPath, dirent.name));
					if (stats.isDirectory()) {
						type = 'directory';
					} else if (stats.isFile()) {
						type = 'file';
						size = stats.size;
					}
				} catch {
					// Keep as symlink if we can't resolve
					type = 'symlink';
				}
			}

			entries.push({
				name: dirent.name,
				type,
				size
			});
		}

		// Sort: directories first, then files, alphabetically within each group
		entries.sort((a, b) => {
			if (a.type === 'directory' && b.type !== 'directory') return -1;
			if (a.type !== 'directory' && b.type === 'directory') return 1;
			return a.name.localeCompare(b.name);
		});

		// Count files and directories
		const fileCount = entries.filter((e) => e.type === 'file').length;
		const directoryCount = entries.filter((e) => e.type === 'directory').length;

		// Format output
		const outputLines: string[] = [];

		for (const entry of entries) {
			let line: string;

			if (entry.type === 'directory') {
				line = `[DIR]  ${entry.name}/`;
			} else if (entry.type === 'symlink') {
				line = `[LNK]  ${entry.name}`;
			} else if (entry.type === 'file') {
				const sizeStr = entry.size !== undefined ? formatSize(entry.size) : '';
				line = `[FILE] ${entry.name}${sizeStr ? ` (${sizeStr})` : ''}`;
			} else {
				line = `[???]  ${entry.name}`;
			}

			outputLines.push(line);
		}

		// Add summary
		outputLines.push('');
		outputLines.push(
			`Total: ${entries.length} items (${directoryCount} directories, ${fileCount} files)`
		);

		return {
			title: params.path,
			output: outputLines.join('\n'),
			metadata: {
				entries,
				fileCount,
				directoryCount
			}
		};
	}

	/**
	 * Format file size in human-readable format
	 */
	function formatSize(bytes: number): string {
		const units = ['B', 'KB', 'MB', 'GB'];
		let size = bytes;
		let unitIndex = 0;

		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex++;
		}

		return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
	}
}
