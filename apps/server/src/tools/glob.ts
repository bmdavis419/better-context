/**
 * Glob Tool
 * Fast file pattern matching in-memory
 */
import * as path from 'node:path';
import { z } from 'zod';
import { Result } from 'better-result';

import type { ToolContext } from './context.ts';
import { VirtualSandbox } from './virtual-sandbox.ts';
import { VirtualFs } from '../vfs/virtual-fs.ts';

export namespace GlobTool {
	// Configuration
	const MAX_RESULTS = 100;

	// Schema for tool parameters
	export const Parameters = z.object({
		pattern: z
			.string()
			.describe('The glob pattern to match files against (e.g. "**/*.ts", "src/**/*.js")'),
		path: z
			.string()
			.optional()
			.describe('The directory to search in. Defaults to the collection root.')
	});

	export type ParametersType = z.infer<typeof Parameters>;

	// Result type
	export type Result = {
		title: string;
		output: string;
		metadata: {
			count: number;
			truncated: boolean;
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
	 * Execute the glob tool
	 */
	export async function execute(params: ParametersType, context: ToolContext): Promise<Result> {
		const { basePath, vfsId } = context;

		// Resolve search path within sandbox
		const searchPath = params.path ? VirtualSandbox.resolvePath(basePath, params.path) : basePath;

		// Validate the search path exists and is a directory
		const stats = await safeStat(searchPath, vfsId);
		if (!stats) {
			return {
				title: params.pattern,
				output: `Directory not found: ${params.path || '.'}`,
				metadata: {
					count: 0,
					truncated: false
				}
			};
		}
		if (!stats.isDirectory) {
			return {
				title: params.pattern,
				output: `Path is not a directory: ${params.path || '.'}`,
				metadata: {
					count: 0,
					truncated: false
				}
			};
		}

		// Collect files matching the pattern
		const files: Array<{ path: string; mtime: number }> = [];
		let truncated = false;

		const patternRegex = globToRegExp(params.pattern);
		const allFiles = await VirtualFs.listFilesRecursive(searchPath, vfsId);
		for (const file of allFiles) {
			if (files.length >= MAX_RESULTS) {
				truncated = true;
				break;
			}
			const relative = path.posix.relative(searchPath, file);
			if (!patternRegex.test(relative)) continue;
			const fileStats = await safeStat(file, vfsId);
			files.push({ path: file, mtime: fileStats?.mtimeMs ?? 0 });
		}

		if (files.length === 0) {
			return {
				title: params.pattern,
				output: 'No files found matching pattern.',
				metadata: {
					count: 0,
					truncated: false
				}
			};
		}

		// Sort by modification time (most recent first)
		files.sort((a, b) => b.mtime - a.mtime);

		// Format output with relative paths
		const outputLines = files.map((f) => path.posix.relative(basePath, f.path));

		// Add truncation notice
		if (truncated) {
			outputLines.push('');
			outputLines.push(
				`[Truncated: Results limited to ${MAX_RESULTS} files. Use a more specific pattern for more targeted results.]`
			);
		}

		return {
			title: params.pattern,
			output: outputLines.join('\n'),
			metadata: {
				count: files.length,
				truncated
			}
		};
	}

	function globToRegExp(pattern: string): RegExp {
		let regex = '^';
		let i = 0;
		while (i < pattern.length) {
			const char = pattern[i] ?? '';
			const next = pattern[i + 1] ?? '';
			if (char === '*' && next === '*') {
				regexAdd('.*');
				i += 2;
				continue;
			}
			if (char === '*') {
				regexAdd('[^/]*');
				i += 1;
				continue;
			}
			if (char === '?') {
				regexAdd('[^/]');
				i += 1;
				continue;
			}
			if ('\\.^$+{}()|[]'.includes(char)) {
				regexAdd('\\' + char);
			} else {
				regexAdd(char);
			}
			i += 1;
		}
		regex += '$';
		return new RegExp(regex);

		function regexAdd(value: string) {
			regex += value;
		}
	}
}
