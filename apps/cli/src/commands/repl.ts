import { Result } from 'better-result';
import { ensureServer, type ServerManager } from '../server/manager.ts';
import { createClient, getResources, askQuestionStream, BtcaError } from '../client/index.ts';
import { parseSSEStream } from '../client/stream.ts';
import type { BtcaStreamEvent } from 'btca-server/stream/types';

type ResourceInfo = { name: string; type: string; url?: string };

export interface ReplOptions {
	server?: string;
	port?: number;
	thinking?: boolean;
	tools?: boolean;
	subAgent?: boolean;
}

/**
 * Format an error for display, including hint if available.
 */
function formatError(error: unknown): string {
	if (error instanceof BtcaError) {
		let output = `Error: ${error.message}`;
		if (error.hint) {
			output += `\n\nHint: ${error.hint}`;
		}
		return output;
	}
	return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Extract @mentions from input
 */
function extractMentions(input: string): string[] {
	const mentionRegex = /(^|[^\w@])@([A-Za-z0-9._/-]+)/g;
	const mentions: string[] = [];
	let match;
	while ((match = mentionRegex.exec(input)) !== null) {
		if (match[2]) mentions.push(match[2]);
	}
	return mentions;
}

/**
 * Remove valid @mentions from input, leaving the question
 */
function cleanInput(input: string, validResources: string[]): string {
	const validSet = new Set(validResources.map((r) => r.toLowerCase()));
	return input
		.replace(/(^|[^\w@])@([A-Za-z0-9._/-]+)/g, (match, prefix, mention) => {
			return validSet.has(mention.toLowerCase()) ? prefix : match;
		})
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Resolve resource name, case-insensitive
 */
function resolveResourceName(input: string, available: ResourceInfo[]): string | null {
	const target = input.toLowerCase();
	const direct = available.find((r) => r.name.toLowerCase() === target);
	if (direct) return direct.name;

	if (target.startsWith('@')) {
		const withoutAt = target.slice(1);
		const match = available.find((r) => r.name.toLowerCase() === withoutAt);
		return match?.name ?? null;
	}

	return null;
}

interface StreamHandlers {
	onReasoningDelta?: (delta: string) => void;
	onTextDelta?: (delta: string) => void;
	onToolCall?: (tool: string) => void;
	onError?: (message: string) => void;
}

function handleStreamEvent(event: BtcaStreamEvent, handlers: StreamHandlers): void {
	switch (event.type) {
		case 'reasoning.delta':
			handlers.onReasoningDelta?.(event.delta);
			break;
		case 'text.delta':
			handlers.onTextDelta?.(event.delta);
			break;
		case 'tool.updated':
			if (event.state.status === 'running') {
				handlers.onToolCall?.(event.tool);
			}
			break;
		case 'error':
			handlers.onError?.(event.message);
			break;
	}
}

/**
 * Simple prompt using Bun's built-in console
 */
async function prompt(message: string): Promise<string | null> {
	process.stdout.write(message);
	const reader = Bun.stdin.stream().getReader();
	const decoder = new TextDecoder();
	let input = '';

	const result = await Result.tryPromise(async () => {
		while (true) {
			const { value, done } = await reader.read();
			if (done) return null;
			input += decoder.decode(value ?? new Uint8Array(), { stream: true });
			const newlineIndex = input.indexOf('\n');
			if (newlineIndex !== -1) {
				return input.slice(0, newlineIndex).trim();
			}
		}
	});
	reader.releaseLock();
	if (result.isErr()) {
		throw result.error;
	}
	return result.value;
}

/**
 * Launch the simple REPL mode (no TUI)
 */
export async function launchRepl(options: ReplOptions): Promise<void> {
	let server: ServerManager | null = null;
	const showThinking = options.subAgent ? false : (options.thinking ?? true);
	const showTools = options.subAgent ? false : (options.tools ?? true);

	const result = await Result.tryPromise(async () => {
		server = await ensureServer({
			serverUrl: options.server,
			port: options.port
		});
		if (!server) {
			throw new Error('Server not initialized');
		}
		const activeServer = server;

		const client = createClient(server.url);
		const { resources } = await getResources(client);

		if (resources.length === 0) {
			console.error('Error: No resources configured.');
			console.error('Add resources to your btca config file.');
			process.exit(1);
		}

		console.log('btca REPL mode (--no-tui)');
		console.log(`Available resources: ${resources.map((r) => r.name).join(', ')}`);
		console.log('Use @resource to specify context. Type /help for commands, /quit to exit.\n');

		// Track accumulated resources for the session
		let sessionResources: string[] = [];

		const printHelp = () => {
			console.log(`
Commands:
  /help           Show this help message
  /resources      List available resources
  /clear          Clear session resources
  /quit, /exit    Exit the REPL

Usage:
  @resource question    Ask a question about a resource
  question              Continue with previous resource(s)

Examples:
  @svelte How do stores work?
  @react @vue Compare component lifecycles
`);
		};

		// Main REPL loop
		while (true) {
			const input = await prompt('btca> ');

			if (input === null) {
				// EOF (Ctrl+D)
				console.log('\nGoodbye!');
				break;
			}

			if (!input) continue;

			// Handle commands
			if (input.startsWith('/')) {
				const cmd = input.toLowerCase();
				if (cmd === '/help') {
					printHelp();
				} else if (cmd === '/resources') {
					console.log(`Available: ${resources.map((r) => r.name).join(', ')}`);
					if (sessionResources.length > 0) {
						console.log(`Session: ${sessionResources.join(', ')}`);
					}
				} else if (cmd === '/clear') {
					sessionResources = [];
					console.log('Session resources cleared.');
				} else if (cmd === '/quit' || cmd === '/exit') {
					console.log('Goodbye!');
					break;
				} else {
					console.log(`Unknown command: ${input}. Type /help for available commands.`);
				}
				continue;
			}

			// Extract @mentions from input
			const mentions = extractMentions(input);
			const validNewResources: string[] = [];

			for (const mention of mentions) {
				const resolved = resolveResourceName(mention, resources);
				if (resolved) validNewResources.push(resolved);
			}

			// Accumulate resources
			if (validNewResources.length > 0) {
				sessionResources = [...new Set([...sessionResources, ...validNewResources])];
			}

			// Require at least one resource
			if (sessionResources.length === 0) {
				console.log('Use @resource to specify context. Example: @svelte How do stores work?');
				continue;
			}

			// Clean the question
			const question = cleanInput(input, sessionResources);
			if (!question) {
				console.log('Please enter a question after the @mention.');
				continue;
			}

			// Stream the response
			const streamResult = await Result.tryPromise(async () => {
				console.log(`[Searching: ${sessionResources.join(', ')}]\n`);

				const response = await askQuestionStream(activeServer.url, {
					question,
					resources: sessionResources,
					quiet: true
				});

				let inReasoning = false;
				let hasText = false;

				for await (const event of parseSSEStream(response)) {
					handleStreamEvent(event, {
						onReasoningDelta: (delta) => {
							if (!showThinking) return;
							if (!inReasoning) {
								process.stdout.write('<thinking>\n');
								inReasoning = true;
							}
							process.stdout.write(delta);
						},
						onTextDelta: (delta) => {
							if (inReasoning) {
								process.stdout.write('\n</thinking>\n\n');
								inReasoning = false;
							}
							hasText = true;
							process.stdout.write(delta);
						},
						onToolCall: (tool) => {
							if (inReasoning) {
								process.stdout.write('\n</thinking>\n\n');
								inReasoning = false;
							}
							if (!showTools) return;
							if (hasText) process.stdout.write('\n');
							console.log(`[${tool}]`);
						},
						onError: (message) => {
							console.error(`\nError: ${message}`);
						}
					});
				}

				if (inReasoning) {
					process.stdout.write('\n</thinking>\n');
				}

				console.log('\n');
			});

			if (Result.isError(streamResult)) {
				console.error(formatError(streamResult.error));
			}
		}

		activeServer.stop();
		process.exit(0);
	});

	if (Result.isError(result)) {
		console.error(formatError(result.error));
		process.exit(1);
	}
}
