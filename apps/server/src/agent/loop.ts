/**
 * Custom Agent Loop
 * Uses AI SDK's streamText with custom tools
 */
import { streamText, tool, stepCountIs, type ModelMessage } from 'ai';

import { Model } from '../providers/index.ts';
import type { ProviderOptions } from '../providers/registry.ts';
import { ReadTool, GrepTool, GlobTool, ListTool } from '../tools/index.ts';

export namespace AgentLoop {
	// Event types for streaming
	export type AgentEvent =
		| { type: 'text-delta'; text: string }
		| { type: 'reasoning-delta'; text: string }
		| { type: 'tool-call'; toolName: string; input: unknown }
		| { type: 'tool-result'; toolName: string; output: string }
		| {
				type: 'finish';
				finishReason: string;
				usage?: { inputTokens?: number; outputTokens?: number };
		  }
		| { type: 'error'; error: Error };

	// Options for the agent loop
	export type Options = {
		providerId: string;
		modelId: string;
		collectionPath: string;
		vfsId?: string;
		agentInstructions: string;
		question: string;
		maxSteps?: number;
		providerOptions?: Partial<ProviderOptions>;
	};

	// Result type
	export type Result = {
		answer: string;
		model: { provider: string; model: string };
		events: AgentEvent[];
	};

	/**
	 * Build the system prompt for the agent
	 */
	function buildSystemPrompt(agentInstructions: string): string {
		return [
			'You are btca, an expert documentation search agent.',
			'Your job is to answer questions by searching through the collection of resources.',
			'',
			'You have access to the following tools:',
			'- read: Read file contents with line numbers',
			'- grep: Search file contents using regex patterns',
			'- glob: Find files matching glob patterns',
			'- list: List directory contents',
			'',
			'Guidelines:',
			'- Use glob to find relevant files first, then read them',
			'- Use grep to search for specific code patterns or text',
			'- Always cite the source files in your answers',
			'- Be concise but thorough in your responses',
			'- If you cannot find the answer, say so clearly',
			'',
			agentInstructions
		].join('\n');
	}

	/**
	 * Create the tools for the agent
	 */
	function createTools(basePath: string, vfsId?: string) {
		return {
			read: tool({
				description: 'Read the contents of a file. Returns the file contents with line numbers.',
				inputSchema: ReadTool.Parameters,
				execute: async (params: ReadTool.ParametersType) => {
					const result = await ReadTool.execute(params, { basePath, vfsId });
					return result.output;
				}
			}),

			grep: tool({
				description:
					'Search for a regex pattern in file contents. Returns matching lines with file paths and line numbers.',
				inputSchema: GrepTool.Parameters,
				execute: async (params: GrepTool.ParametersType) => {
					const result = await GrepTool.execute(params, { basePath, vfsId });
					return result.output;
				}
			}),

			glob: tool({
				description:
					'Find files matching a glob pattern (e.g. "**/*.ts", "src/**/*.js"). Returns a list of matching file paths sorted by modification time.',
				inputSchema: GlobTool.Parameters,
				execute: async (params: GlobTool.ParametersType) => {
					const result = await GlobTool.execute(params, { basePath, vfsId });
					return result.output;
				}
			}),

			list: tool({
				description:
					'List the contents of a directory. Returns files and subdirectories with their types.',
				inputSchema: ListTool.Parameters,
				execute: async (params: ListTool.ParametersType) => {
					const result = await ListTool.execute(params, { basePath, vfsId });
					return result.output;
				}
			})
		};
	}

	/**
	 * Get initial context by listing the collection directory
	 */
	async function getInitialContext(collectionPath: string, vfsId?: string) {
		const result = await ListTool.execute({ path: '.' }, { basePath: collectionPath, vfsId });
		return `Collection contents:\n${result.output}`;
	}

	/**
	 * Run the agent loop and return the final answer
	 */
	export async function run(options: Options): Promise<Result> {
		const {
			providerId,
			modelId,
			collectionPath,
			vfsId,
			agentInstructions,
			question,
			maxSteps = 40
		} = options;

		const systemPrompt = buildSystemPrompt(agentInstructions);
		const sessionId = crypto.randomUUID();

		const mergedProviderOptions =
			providerId === 'openai'
				? { ...options.providerOptions, instructions: systemPrompt, sessionId }
				: options.providerOptions;

		// Get the model
		const model = await Model.getModel(providerId, modelId, {
			providerOptions: mergedProviderOptions,
			allowMissingAuth: providerId === 'openai-compat'
		});

		// Get initial context
		const initialContext = await getInitialContext(collectionPath, vfsId);

		// Build messages
		const messages: ModelMessage[] = [
			{
				role: 'user',
				content: `${initialContext}\n\nQuestion: ${question}`
			}
		];

		// Create tools
		const tools = createTools(collectionPath, vfsId);

		// Collect events
		const events: AgentEvent[] = [];
		let fullText = '';

		// Run streamText with tool execution
		const result = streamText({
			model,
			system: systemPrompt,
			messages,
			tools,
			providerOptions:
				providerId === 'openai'
					? { openai: { instructions: systemPrompt, store: false } }
					: undefined,
			stopWhen: stepCountIs(maxSteps)
		});

		// Process the stream
		for await (const part of result.fullStream) {
			switch (part.type) {
				case 'text-delta':
					fullText += part.text;
					events.push({ type: 'text-delta', text: part.text });
					break;

				case 'reasoning-delta':
					events.push({ type: 'reasoning-delta', text: part.text });
					break;

				case 'tool-call':
					events.push({
						type: 'tool-call',
						toolName: part.toolName,
						input: part.input
					});
					break;

				case 'tool-result':
					events.push({
						type: 'tool-result',
						toolName: part.toolName,
						output: typeof part.output === 'string' ? part.output : JSON.stringify(part.output)
					});
					break;

				case 'finish':
					events.push({
						type: 'finish',
						finishReason: part.finishReason ?? 'unknown',
						usage: {
							inputTokens: part.totalUsage?.inputTokens,
							outputTokens: part.totalUsage?.outputTokens
						}
					});
					break;

				case 'error':
					events.push({
						type: 'error',
						error: part.error instanceof Error ? part.error : new Error(String(part.error))
					});
					break;
			}
		}

		return {
			answer: fullText.trim(),
			model: { provider: providerId, model: modelId },
			events
		};
	}

	/**
	 * Run the agent loop and stream events
	 */
	export async function* stream(options: Options): AsyncGenerator<AgentEvent> {
		const {
			providerId,
			modelId,
			collectionPath,
			vfsId,
			agentInstructions,
			question,
			maxSteps = 40
		} = options;

		const systemPrompt = buildSystemPrompt(agentInstructions);
		const sessionId = crypto.randomUUID();

		const mergedProviderOptions =
			providerId === 'openai'
				? { ...options.providerOptions, instructions: systemPrompt, sessionId }
				: options.providerOptions;

		// Get the model
		const model = await Model.getModel(providerId, modelId, {
			providerOptions: mergedProviderOptions,
			allowMissingAuth: providerId === 'openai-compat'
		});

		// Get initial context
		const initialContext = await getInitialContext(collectionPath, vfsId);

		// Build messages
		const messages: ModelMessage[] = [
			{
				role: 'user',
				content: `${initialContext}\n\nQuestion: ${question}`
			}
		];

		// Create tools
		const tools = createTools(collectionPath, vfsId);

		// Run streamText with tool execution
		const result = streamText({
			model,
			system: systemPrompt,
			messages,
			tools,
			providerOptions:
				providerId === 'openai'
					? { openai: { instructions: systemPrompt, store: false } }
					: undefined,
			stopWhen: stepCountIs(maxSteps)
		});

		// Stream events
		for await (const part of result.fullStream) {
			switch (part.type) {
				case 'text-delta':
					yield { type: 'text-delta', text: part.text };
					break;

				case 'reasoning-delta':
					yield { type: 'reasoning-delta', text: part.text };
					break;

				case 'tool-call':
					yield {
						type: 'tool-call',
						toolName: part.toolName,
						input: part.input
					};
					break;

				case 'tool-result':
					yield {
						type: 'tool-result',
						toolName: part.toolName,
						output: typeof part.output === 'string' ? part.output : JSON.stringify(part.output)
					};
					break;

				case 'finish':
					yield {
						type: 'finish',
						finishReason: part.finishReason ?? 'unknown',
						usage: {
							inputTokens: part.totalUsage?.inputTokens,
							outputTokens: part.totalUsage?.outputTokens
						}
					};
					break;

				case 'error':
					yield {
						type: 'error',
						error: part.error instanceof Error ? part.error : new Error(String(part.error))
					};
					break;
			}
		}
	}
}
