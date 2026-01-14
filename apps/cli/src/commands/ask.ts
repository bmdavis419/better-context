import { Command } from 'commander';
import { ensureServer } from '../server/manager.ts';
import { createClient, getResources, askQuestionStream, BtcaError } from '../client/index.ts';
import { parseSSEStream } from '../client/stream.ts';
import type { BtcaStreamEvent } from 'btca-server/stream/types';

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
 * Parse @mentions from query string
 */
function parseQuery(query: string): { query: string; resources: string[] } {
	const mentionRegex = /@(\w+)/g;
	const resources: string[] = [];
	let match;

	while ((match = mentionRegex.exec(query)) !== null) {
		if (match[1]) {
			resources.push(match[1]);
		}
	}

	// Remove @mentions from query
	const cleanQuery = query.replace(mentionRegex, '').trim();

	return { query: cleanQuery, resources };
}

/**
 * Merge CLI -r flags with @mentions, deduplicating
 */
function mergeResources(cliResources: string[], mentionedResources: string[]): string[] {
	const all = [...cliResources, ...mentionedResources];
	return [...new Set(all)];
}

export const askCommand = new Command('ask')
	.description('Ask a question about configured resources')
	.requiredOption('-q, --question <text>', 'Question to ask')
	.option('-r, --resource <name...>', 'Resources to search (can specify multiple)')
	.action(async (options, command) => {
		const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;

		// Check for deprecated -t flag usage (not registered, but might be in user's muscle memory)
		const rawArgs = process.argv;
		if (rawArgs.includes('-t') || rawArgs.includes('--tech')) {
			console.error('Error: The -t/--tech flag has been deprecated.');
			console.error('Use -r/--resource instead: btca ask -r <resource> -q "your question"');
			console.error('You can specify multiple resources: btca ask -r svelte -r effect -q "..."');
			process.exit(1);
		}

		try {
			const server = await ensureServer({
				serverUrl: globalOpts?.server,
				port: globalOpts?.port,
				quiet: true
			});

			const client = createClient(server.url);

			// Parse @mentions from question
			const parsed = parseQuery(options.question as string);

			// Merge CLI -r flags with @mentions
			const resourceNames = mergeResources(
				(options.resource as string[] | undefined) ?? [],
				parsed.resources
			);

			// If no resources specified, validate that some exist
			if (resourceNames.length === 0) {
				const { resources } = await getResources(client);
				if (resources.length === 0) {
					console.error('Error: No resources configured.');
					console.error('Add resources to your btca config file.');
					process.exit(1);
				}
				// Use all resources if none specified
				resourceNames.push(...resources.map((r) => r.name));
			}

			console.log('loading resources...');

			// Stream the response
			const response = await askQuestionStream(server.url, {
				question: parsed.query,
				resources: resourceNames,
				quiet: true
			});

			let receivedMeta = false;
			let inReasoning = false;
			let hasText = false;

			for await (const event of parseSSEStream(response)) {
				handleStreamEvent(event, {
					onMeta: () => {
						if (!receivedMeta) {
							console.log('creating collection...\n');
							receivedMeta = true;
						}
					},
					onReasoningDelta: (delta) => {
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
						if (hasText) {
							process.stdout.write('\n');
						}
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
			server.stop();
			process.exit(0);
		} catch (error) {
			console.error(formatError(error));
			process.exit(1);
		}
	});

interface StreamHandlers {
	onMeta?: () => void;
	onReasoningDelta?: (delta: string) => void;
	onTextDelta?: (delta: string) => void;
	onToolCall?: (tool: string) => void;
	onError?: (message: string) => void;
}

function handleStreamEvent(event: BtcaStreamEvent, handlers: StreamHandlers): void {
	switch (event.type) {
		case 'meta':
			handlers.onMeta?.();
			break;
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
		case 'done':
			break;
	}
}
