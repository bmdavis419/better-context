/**
 * Glob Tool
 * Fast file pattern matching using ripgrep
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';

import { Ripgrep } from './ripgrep.ts';
import { Sandbox } from './sandbox.ts';

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

	/**
	 * Execute the glob tool
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
						count: 0,
						truncated: false
					}
				};
			}
		} catch {
			return {
				title: params.pattern,
				output: `Directory not found: ${params.path || '.'}`,
				metadata: {
					count: 0,
					truncated: false
				}
			};
		}

		// Collect files matching the pattern
		const files: Array<{ path: string; mtime: number }> = [];
		let truncated = false;

		for await (const file of Ripgrep.files({
			cwd: searchPath,
			glob: [params.pattern],
			hidden: true
		})) {
			if (files.length >= MAX_RESULTS) {
				truncated = true;
				break;
			}

			const fullPath = path.resolve(searchPath, file);

			try {
				const stats = await fs.stat(fullPath);
				files.push({
					path: fullPath,
					mtime: stats.mtime.getTime()
				});
			} catch {
				// Skip files we can't stat
				files.push({
					path: fullPath,
					mtime: 0
				});
			}
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
		const outputLines = files.map((f) => path.relative(basePath, f.path));

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
}
