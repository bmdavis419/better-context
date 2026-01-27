/**
 * Read Tool
 * Reads file contents with line numbers, truncation, and special file handling
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';

import { Sandbox } from './sandbox.ts';

export namespace ReadTool {
	// Configuration
	const MAX_LINES = 2000;
	const MAX_BYTES = 50 * 1024; // 50KB
	const MAX_LINE_LENGTH = 2000;

	// Schema for tool parameters
	export const Parameters = z.object({
		path: z.string().describe('The absolute path to the file to read'),
		offset: z.coerce
			.number()
			.optional()
			.describe('The line number to start reading from (0-based)'),
		limit: z.coerce.number().optional().describe('The number of lines to read (defaults to 2000)')
	});

	export type ParametersType = z.infer<typeof Parameters>;

	// Result type
	export type Result = {
		title: string;
		output: string;
		metadata: {
			lines: number;
			truncated: boolean;
			truncatedByLines?: boolean;
			truncatedByBytes?: boolean;
			isImage?: boolean;
			isPdf?: boolean;
			isBinary?: boolean;
		};
		// For images/PDFs, we return attachments
		attachments?: Array<{
			type: 'file';
			mime: string;
			data: string; // base64
		}>;
	};

	// Image extensions
	const IMAGE_EXTENSIONS = new Set([
		'.png',
		'.jpg',
		'.jpeg',
		'.gif',
		'.webp',
		'.bmp',
		'.ico',
		'.svg'
	]);

	// PDF extension
	const PDF_EXTENSIONS = new Set(['.pdf']);

	/**
	 * Check if a file is binary by looking for null bytes
	 */
	async function isBinaryFile(filepath: string): Promise<boolean> {
		const file = Bun.file(filepath);
		const chunk = await file.slice(0, 8192).arrayBuffer();
		const bytes = new Uint8Array(chunk);

		for (const byte of bytes) {
			if (byte === 0) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Execute the read tool
	 */
	export async function execute(
		params: ParametersType,
		context: { basePath: string }
	): Promise<Result> {
		const { basePath } = context;

		// Validate and resolve path within sandbox
		const resolvedPath = await Sandbox.resolvePathWithSymlinks(basePath, params.path);

		// Check if file exists
		const file = Bun.file(resolvedPath);
		if (!(await file.exists())) {
			// Try to provide suggestions
			const dir = path.dirname(resolvedPath);
			const filename = path.basename(resolvedPath);
			let suggestions: string[] = [];

			try {
				const files = await fs.readdir(dir);
				suggestions = files
					.filter((f) => f.toLowerCase().includes(filename.toLowerCase().slice(0, 3)))
					.slice(0, 5);
			} catch {
				// Directory doesn't exist
			}

			const suggestionText =
				suggestions.length > 0
					? `\nDid you mean:\n${suggestions.map((s) => `  - ${s}`).join('\n')}`
					: '';

			return {
				title: params.path,
				output: `File not found: ${params.path}${suggestionText}`,
				metadata: {
					lines: 0,
					truncated: false
				}
			};
		}

		const ext = path.extname(resolvedPath).toLowerCase();

		// Handle images
		if (IMAGE_EXTENSIONS.has(ext)) {
			const bytes = await file.arrayBuffer();
			const base64 = Buffer.from(bytes).toString('base64');
			const mime = file.type || 'application/octet-stream';

			return {
				title: params.path,
				output: `[Image file: ${path.basename(resolvedPath)}]`,
				metadata: {
					lines: 0,
					truncated: false,
					isImage: true
				},
				attachments: [
					{
						type: 'file',
						mime,
						data: base64
					}
				]
			};
		}

		// Handle PDFs
		if (PDF_EXTENSIONS.has(ext)) {
			const bytes = await file.arrayBuffer();
			const base64 = Buffer.from(bytes).toString('base64');

			return {
				title: params.path,
				output: `[PDF file: ${path.basename(resolvedPath)}]`,
				metadata: {
					lines: 0,
					truncated: false,
					isPdf: true
				},
				attachments: [
					{
						type: 'file',
						mime: 'application/pdf',
						data: base64
					}
				]
			};
		}

		// Check for binary files
		if (await isBinaryFile(resolvedPath)) {
			return {
				title: params.path,
				output: `[Binary file: ${path.basename(resolvedPath)}]`,
				metadata: {
					lines: 0,
					truncated: false,
					isBinary: true
				}
			};
		}

		// Read text file
		const text = await file.text();
		const allLines = text.split('\n');

		const offset = params.offset ?? 0;
		const limit = params.limit ?? MAX_LINES;

		// Apply truncation
		let truncatedByLines = false;
		let truncatedByBytes = false;

		const outputLines: string[] = [];
		let totalBytes = 0;

		const endLine = Math.min(allLines.length, offset + limit);

		for (let i = offset; i < endLine; i++) {
			let line = allLines[i] ?? '';

			// Truncate long lines
			if (line.length > MAX_LINE_LENGTH) {
				line = line.substring(0, MAX_LINE_LENGTH) + '...';
			}

			const lineBytes = Buffer.byteLength(line, 'utf8');

			if (totalBytes + lineBytes > MAX_BYTES) {
				truncatedByBytes = true;
				break;
			}

			outputLines.push(line);
			totalBytes += lineBytes;
		}

		if (outputLines.length < endLine - offset || endLine < allLines.length) {
			truncatedByLines = !truncatedByBytes && outputLines.length >= limit;
		}

		// Format output with line numbers
		const formattedOutput = outputLines
			.map((line, index) => {
				const lineNum = (index + offset + 1).toString().padStart(5, ' ');
				return `${lineNum}\t${line}`;
			})
			.join('\n');

		// Build truncation message
		let truncationMessage = '';
		if (truncatedByBytes || truncatedByLines) {
			const remaining = allLines.length - offset - outputLines.length;
			if (remaining > 0) {
				truncationMessage = `\n\n[Truncated: ${remaining} more lines. Use offset=${offset + outputLines.length} to continue reading.]`;
			}
		}

		return {
			title: params.path,
			output: formattedOutput + truncationMessage,
			metadata: {
				lines: outputLines.length,
				truncated: truncatedByBytes || truncatedByLines,
				truncatedByLines,
				truncatedByBytes
			}
		};
	}
}
