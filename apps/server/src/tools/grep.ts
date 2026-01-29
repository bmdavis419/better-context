/**
 * Grep Tool
 * Searches file contents using regular expressions in-memory
 */
import * as path from 'node:path';
import { z } from 'zod';
import { Result } from 'better-result';

import type { ToolContext } from './context.ts';
import { VirtualSandbox } from './virtual-sandbox.ts';
import { VirtualFs } from '../vfs/virtual-fs.ts';

export namespace GrepTool {
	// Configuration
	const MAX_RESULTS = 100;

	// Schema for tool parameters
	export const Parameters = z.object({
		pattern: z.string().describe('The regex pattern to search for in file contents'),
		path: z
			.string()
			.optional()
			.describe('The directory to search in. Defaults to the collection root.'),
		include: z
			.string()
			.optional()
			.describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")')
	});

	export type ParametersType = z.infer<typeof Parameters>;

	// Result type
	export type Result = {
		title: string;
		output: string;
		metadata: {
			matchCount: number;
			fileCount: number;
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

	const safeReadBuffer = async (filePath: string, vfsId?: string) => {
		const result = await Result.tryPromise(() => VirtualFs.readFileBuffer(filePath, vfsId));
		return result.match({
			ok: (value) => value,
			err: () => null
		});
	};

	const compileRegex = (pattern: string) =>
		Result.try(() => new RegExp(pattern)).match({
			ok: (value) => value,
			err: () => null
		});

	/**
	 * Execute the grep tool
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
					matchCount: 0,
					fileCount: 0,
					truncated: false
				}
			};
		}
		if (!stats.isDirectory) {
			return {
				title: params.pattern,
				output: `Path is not a directory: ${params.path || '.'}`,
				metadata: {
					matchCount: 0,
					fileCount: 0,
					truncated: false
				}
			};
		}

		const regex = compileRegex(params.pattern);
		if (!regex) {
			return {
				title: params.pattern,
				output: 'Invalid regex pattern.',
				metadata: {
					matchCount: 0,
					fileCount: 0,
					truncated: false
				}
			};
		}

		const includeMatcher = params.include ? buildIncludeMatcher(params.include) : null;
		const allFiles = await VirtualFs.listFilesRecursive(searchPath, vfsId);
		const results: Array<{ path: string; lineNumber: number; lineText: string; mtime: number }> =
			[];

		for (const filePath of allFiles) {
			if (results.length > MAX_RESULTS) break;
			const relative = path.posix.relative(searchPath, filePath);
			if (includeMatcher && !includeMatcher(relative)) continue;
			const buffer = await safeReadBuffer(filePath, vfsId);
			if (!buffer) continue;
			if (isBinaryBuffer(buffer)) continue;
			const text = await VirtualFs.readFile(filePath, vfsId);
			const lines = text.split('\n');
			const fileStats = await safeStat(filePath, vfsId);
			const mtime = fileStats?.mtimeMs ?? 0;
			for (let i = 0; i < lines.length; i++) {
				const lineText = lines[i] ?? '';
				if (!regex.test(lineText)) continue;
				results.push({
					path: filePath,
					lineNumber: i + 1,
					lineText,
					mtime
				});
				if (results.length > MAX_RESULTS) break;
			}
		}

		if (results.length === 0) {
			return {
				title: params.pattern,
				output: 'No matches found.',
				metadata: {
					matchCount: 0,
					fileCount: 0,
					truncated: false
				}
			};
		}

		const truncated = results.length > MAX_RESULTS;
		const displayResults = truncated ? results.slice(0, MAX_RESULTS) : results;
		displayResults.sort((a, b) => b.mtime - a.mtime);

		const fileGroups = new Map<string, Array<{ lineNumber: number; lineText: string }>>();
		for (const result of displayResults) {
			const relativePath = path.posix.relative(basePath, result.path);
			if (!fileGroups.has(relativePath)) {
				fileGroups.set(relativePath, []);
			}
			fileGroups.get(relativePath)!.push({
				lineNumber: result.lineNumber,
				lineText: result.lineText
			});
		}

		const outputLines: string[] = [];
		for (const [filePath, matches] of fileGroups) {
			outputLines.push(`${filePath}:`);
			for (const match of matches) {
				const lineText =
					match.lineText.length > 200 ? match.lineText.substring(0, 200) + '...' : match.lineText;
				outputLines.push(`  ${match.lineNumber}: ${lineText}`);
			}
			outputLines.push('');
		}

		if (truncated) {
			outputLines.push(
				`[Truncated: Results limited to ${MAX_RESULTS} matches. Narrow your search pattern for more specific results.]`
			);
		}

		return {
			title: params.pattern,
			output: outputLines.join('\n').trim(),
			metadata: {
				matchCount: displayResults.length,
				fileCount: fileGroups.size,
				truncated
			}
		};
	}

	function isBinaryBuffer(bytes: Uint8Array): boolean {
		for (const byte of bytes) {
			if (byte === 0) return true;
		}
		return false;
	}

	function globToRegExp(pattern: string): RegExp {
		let regex = '^';
		let i = 0;
		while (i < pattern.length) {
			const char = pattern[i] ?? '';
			const next = pattern[i + 1] ?? '';
			if (char === '*' && next === '*') {
				regex += '.*';
				i += 2;
				continue;
			}
			if (char === '*') {
				regex += '[^/]*';
				i += 1;
				continue;
			}
			if (char === '?') {
				regex += '[^/]';
				i += 1;
				continue;
			}
			if ('\\.^$+{}()|[]'.includes(char)) {
				regex += '\\' + char;
			} else {
				regex += char;
			}
			i += 1;
		}
		regex += '$';
		return new RegExp(regex);
	}

	function buildIncludeMatcher(pattern: string): (relativePath: string) => boolean {
		const regex = globToRegExp(pattern);
		if (!pattern.includes('/')) {
			return (relativePath) =>
				regex.test(path.posix.basename(relativePath)) || regex.test(relativePath);
		}
		return (relativePath) => regex.test(relativePath);
	}
}
