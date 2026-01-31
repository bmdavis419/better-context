import { Result } from 'better-result';
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
 * Extract potential @mentions from query string (without modifying the query yet)
 */
function extractMentions(query: string): string[] {
	const mentionRegex = /(^|[^\w@])@([A-Za-z0-9._/-]+)/g;
	const mentions: string[] = [];
	let match;

	while ((match = mentionRegex.exec(query)) !== null) {
		if (match[2]) {
			mentions.push(match[2]);
		}
	}

	return mentions;
}

/**
 * Remove only the valid resource @mentions from the query, leaving others intact
 */
function cleanQueryOfValidResources(query: string, validResources: string[]): string {
	const validSet = new Set(validResources.map((r) => r.toLowerCase()));
	return query
		.replace(/(^|[^\w@])@([A-Za-z0-9._/-]+)/g, (match, prefix, mention) => {
			return validSet.has(mention.toLowerCase()) ? prefix : match;
		})
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Merge CLI -r flags with @mentions, deduplicating
 */
function mergeResources(cliResources: string[], mentionedResources: string[]): string[] {
	const all = [...cliResources, ...mentionedResources];
	return [...new Set(all)];
}

type AvailableResource = { name: string };

function resolveResourceName(input: string, available: AvailableResource[]): string | null {
	const target = input.toLowerCase();
	const direct = available.find((r) => r.name.toLowerCase() === target);
	if (direct) return direct.name;

	if (target.startsWith('@')) {
		const withoutAt = target.slice(1);
		const match = available.find((r) => r.name.toLowerCase() === withoutAt);
		return match?.name ?? null;
	}

	const withAt = `@${target}`;
	const match = available.find((r) => r.name.toLowerCase() === withAt);
	return match?.name ?? null;
}

function normalizeResourceNames(
	inputs: string[],
	available: AvailableResource[]
): { names: string[]; invalid: string[] } {
	const resolved: string[] = [];
	const invalid: string[] = [];

	for (const input of inputs) {
		const resolvedName = resolveResourceName(input, available);
		if (resolvedName) resolved.push(resolvedName);
		else invalid.push(input);
	}

	return { names: [...new Set(resolved)], invalid };
}

export const askCommand = new Command('ask')
	.description('Ask a question about configured resources')
	.requiredOption('-q, --question <text>', 'Question to ask')
	.option('-r, --resource <name...>', 'Resources to search (can specify multiple)')
	.option('--no-thinking', 'Hide reasoning output')
	.option('--no-tools', 'Hide tool-call traces')
	.option('--sub-agent', 'Emit clean output (no reasoning or tool traces)')
	.action(async (options, command) => {
		const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;
		const showThinking = options.subAgent ? false : (options.thinking ?? true);
		const showTools = options.subAgent ? false : (options.tools ?? true);

		// Check for deprecated -t flag usage (not registered, but might be in user's muscle memory)
		const rawArgs = process.argv;
		if (rawArgs.includes('-t') || rawArgs.includes('--tech')) {
			console.error('Error: The -t/--tech flag has been deprecated.');
			console.error('Use -r/--resource instead: btca ask -r <resource> -q "your question"');
			console.error('You can specify multiple resources: btca ask -r svelte -r effect -q "..."');
			process.exit(1);
		}

		const result = await Result.tryPromise(async () => {
			const server = await ensureServer({
				serverUrl: globalOpts?.server,
				port: globalOpts?.port,
				quiet: true
			});

			const client = createClient(server.url);

			const { resources } = await getResources(client);
			if (resources.length === 0) {
				console.error('Error: No resources configured.');
				console.error('Add resources to your btca config file.');
				process.exit(1);
			}

			const questionText = options.question as string;
			const cliResources = (options.resource as string[] | undefined) ?? [];
			const mentionedResources = extractMentions(questionText);

			const allRequestedResources = mergeResources(cliResources, mentionedResources);

			const normalized = normalizeResourceNames(allRequestedResources, resources);

			const resourceNames: string[] =
				normalized.names.length > 0 ? normalized.names : resources.map((r) => r.name);

			const cleanedQuery = cleanQueryOfValidResources(questionText, normalized.names);

			console.log('loading resources...');

			// Stream the response
			const response = await askQuestionStream(server.url, {
				question: cleanedQuery,
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
		});

		if (Result.isError(result)) {
			console.error(formatError(result.error));
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
