/**
 * List Tool
 * Lists directory contents with file types
 */
import * as path from 'node:path';
import { z } from 'zod';
import { Result } from 'better-result';

import type { ToolContext } from './context.ts';
import { VirtualSandbox } from './virtual-sandbox.ts';
import { VirtualFs } from '../vfs/virtual-fs.ts';

export namespace ListTool {
	// Schema for tool parameters
	export const Parameters = z.object({
		path: z.string().describe('The directory path to list')
	});

	export type ParametersType = z.infer<typeof Parameters>;

	// Entry type
	export type Entry = {
		name: string;
		type: 'file' | 'directory' | 'other';
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

	const safeStat = async (filePath: string, vfsId?: string) => {
		const result = await Result.tryPromise(() => VirtualFs.stat(filePath, vfsId));
		return result.match({
			ok: (value) => value,
			err: () => null
		});
	};

	/**
	 * Execute the list tool
	 */
	export async function execute(params: ParametersType, context: ToolContext): Promise<Result> {
		const { basePath, vfsId } = context;

		// Resolve path within sandbox
		const resolvedPath = VirtualSandbox.resolvePath(basePath, params.path);

		// Check if path exists
		const stats = await safeStat(resolvedPath, vfsId);
		if (!stats) {
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
		if (!stats.isDirectory) {
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

		// Read directory contents
		const entries: Entry[] = [];

		const dirents = await VirtualFs.readdir(resolvedPath, vfsId);
		for (const dirent of dirents) {
			let type: Entry['type'] = 'other';
			let size: number | undefined;
			if (dirent.isDirectory) {
				type = 'directory';
			} else if (dirent.isFile) {
				type = 'file';
				const stats = await safeStat(path.posix.join(resolvedPath, dirent.name), vfsId);
				size = stats?.size;
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
