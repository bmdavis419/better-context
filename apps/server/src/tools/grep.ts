/**
 * Grep Tool
 * Searches file contents using regular expressions via ripgrep
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';

import { Ripgrep } from './ripgrep.ts';
import { Sandbox } from './sandbox.ts';

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

	/**
	 * Execute the grep tool
	 */
	export async function execute(
		params: ParametersType,
		context: { basePath: string }
	): Promise<Result> {
		const { basePath } = context;

		// Resolve search path within sandbox
		const searchPath = params.path ? Sandbox.resolvePath(basePath, params.path) : basePath;

		// Validate the search path exists and is a directory
		try {
			const stats = await fs.stat(searchPath);
			if (!stats.isDirectory()) {
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
		} catch {
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

		// Run ripgrep search
		const results = await Ripgrep.search({
			cwd: searchPath,
			pattern: params.pattern,
			glob: params.include,
			hidden: true,
			maxResults: MAX_RESULTS + 1 // Get one extra to check for truncation
		});

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

		// Check for truncation
		const truncated = results.length > MAX_RESULTS;
		const displayResults = truncated ? results.slice(0, MAX_RESULTS) : results;

		// Sort by modification time (most recent first)
		// Get file modification times
		const filesWithMtime = await Promise.all(
			displayResults.map(async (result) => {
				try {
					const stats = await fs.stat(result.path);
					return { ...result, mtime: stats.mtime.getTime() };
				} catch {
					return { ...result, mtime: 0 };
				}
			})
		);

		filesWithMtime.sort((a, b) => b.mtime - a.mtime);

		// Group results by file
		const fileGroups = new Map<string, Array<{ lineNumber: number; lineText: string }>>();

		for (const result of filesWithMtime) {
			const relativePath = path.relative(basePath, result.path);
			if (!fileGroups.has(relativePath)) {
				fileGroups.set(relativePath, []);
			}
			fileGroups.get(relativePath)!.push({
				lineNumber: result.lineNumber,
				lineText: result.lineText
			});
		}

		// Format output
		const outputLines: string[] = [];

		for (const [filePath, matches] of fileGroups) {
			outputLines.push(`${filePath}:`);
			for (const match of matches) {
				// Truncate long lines
				const lineText =
					match.lineText.length > 200 ? match.lineText.substring(0, 200) + '...' : match.lineText;
				outputLines.push(`  ${match.lineNumber}: ${lineText}`);
			}
			outputLines.push(''); // Empty line between files
		}

		// Add truncation notice
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
}
