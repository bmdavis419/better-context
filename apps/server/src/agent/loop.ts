/**
 * Custom Agent Loop
 * Uses AI SDK's streamText with custom tools
 */
import { streamText, tool, stepCountIs, type ModelMessage } from 'ai';

import { getModel } from '../providers/index.ts';
import type { ProviderOptions } from '../providers/registry.ts';
import type {
	ReadToolParametersType,
	GrepToolParametersType,
	GlobToolParametersType,
	ListToolParametersType
} from '../tools/index.ts';
import {
	ReadToolParameters,
	executeReadTool,
	GrepToolParameters,
	executeGrepTool,
	GlobToolParameters,
	executeGlobTool,
	ListToolParameters,
	executeListTool
} from '../tools/index.ts';

export type AgentEvent =
	| { type: 'text-delta'; text: string }
	| { type: 'reasoning-delta'; text: string }
	| { type: 'tool-call'; toolName: string; input: unknown }
	| { type: 'tool-result'; toolName: string; output: string }
	| {
			type: 'finish';
			finishReason: string;
			usage?: {
				inputTokens?: number;
				outputTokens?: number;
				reasoningTokens?: number;
				cachedTokens?: number;
				cacheReadTokens?: number;
				cacheWriteTokens?: number;
				totalTokens?: number;
			};
	  }
	| { type: 'error'; error: Error };

export type AgentLoopOptions = {
	providerId: string;
	modelId: string;
	collectionPath: string;
	vfsId?: string;
	agentInstructions: string;
	question: string;
	maxSteps?: number;
	providerOptions?: Partial<ProviderOptions>;
};

export type AgentLoopResult = {
	answer: string;
	model: { provider: string; model: string };
	events: AgentEvent[];
};

const BASE_PROMPT = `
You are btca, an expert research agent. Your job is to answer questions from the user by searching the resources at your disposal.

<personality_and_writing_controls>
- Persona: an expert professional researcher
- Channel: internal
- Emotional register: direct, calm, and concise
- Formatting: bulleted/numbered lists are good + codeblocks
- Length: be thorough with your response, don't let it get too long though
- Default follow-through: don't ask permission to do the research, just do it and answer the question. ask for clarifications + suggest good follow up if needed
</personality_and_writing_controls>

<parallel_tool_calling>
- When multiple retrieval or lookup steps are independent, prefer parallel tool calls to reduce wall-clock time.
- Do not parallelize steps that have prerequisite dependencies or where one result determines the next action.
- After parallel retrieval, pause to synthesize the results before making more calls.
- Prefer selective parallelism: parallelize independent evidence gathering, not speculative or redundant tool use.
</parallel_tool_calling>

<tool_persistence_rules>
- Use tools whenever they materially improve correctness, completeness, or grounding.
- Do NOT stop early to save tool calls.
- Keep calling tools until either:
	1) the task is complete
	2) you've hit a doom loop where none of the tools function or something is missing
- If a tool returns empty/partial results, retry with a different strategy (query, filters, alternate source).
</tool_persistence_rules>

<completeness_contract>
- Treat the task as incomplete until you have a complete answer to the user's question that's grounded
- If any item is blocked by missing data, mark it [blocked] and state exactly what is missing.
</completeness_contract>

<dig_deeper_nudge>
- Don't stop at the first plausible answer.
- Look for second-order issues, edge cases, and missing constraints.
</dig_deeper_nudge>

<output_contract>
- Return a thorough answer to the user's question with real code examples
- Always output in proper markdown format
- Always include sources for your answer:
	- For git resources, source links must be full github blob urls
	- In "Sources", format git citations as markdown links: - [repo/relative/path.ext](https://github.com/.../blob/.../repo/relative/path.ext)".'
	- For local resources cite local file paths
	- For npm resources cite the path in the npm package
</output_contract>
`;

const buildSystemPrompt = (agentInstructions: string): string =>
	[BASE_PROMPT, agentInstructions].join('\n');

const createTools = (basePath: string, vfsId?: string) => ({
	read: tool({
		description: 'Read the contents of a file. Returns the file contents with line numbers.',
		inputSchema: ReadToolParameters,
		execute: async (params: ReadToolParametersType) => {
			const result = await executeReadTool(params, { basePath, vfsId });
			return result.output;
		}
	}),

	grep: tool({
		description:
			'Search for a regex pattern in file contents. Returns matching lines with file paths and line numbers.',
		inputSchema: GrepToolParameters,
		execute: async (params: GrepToolParametersType) => {
			const result = await executeGrepTool(params, { basePath, vfsId });
			return result.output;
		}
	}),

	glob: tool({
		description:
			'Find files matching a glob pattern (e.g. "**/*.ts", "src/**/*.js"). Returns a list of matching file paths sorted by modification time.',
		inputSchema: GlobToolParameters,
		execute: async (params: GlobToolParametersType) => {
			const result = await executeGlobTool(params, { basePath, vfsId });
			return result.output;
		}
	}),

	list: tool({
		description:
			'List the contents of a directory. Returns files and subdirectories with their types.',
		inputSchema: ListToolParameters,
		execute: async (params: ListToolParametersType) => {
			const result = await executeListTool(params, { basePath, vfsId });
			return result.output;
		}
	})
});

const getInitialContext = async (collectionPath: string, vfsId?: string) => {
	const result = await executeListTool({ path: '.' }, { basePath: collectionPath, vfsId });
	return `Collection contents:\n${result.output}`;
};

export const runAgentLoop = async (options: AgentLoopOptions): Promise<AgentLoopResult> => {
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

	const model = await getModel(providerId, modelId, {
		providerOptions: mergedProviderOptions,
		allowMissingAuth: providerId === 'openai-compat'
	});

	const initialContext = await getInitialContext(collectionPath, vfsId);
	const messages: ModelMessage[] = [
		{
			role: 'user',
			content: `${initialContext}\n\nQuestion: ${question}`
		}
	];

	const tools = createTools(collectionPath, vfsId);
	const events: AgentEvent[] = [];
	let fullText = '';

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
				events.push({ type: 'tool-call', toolName: part.toolName, input: part.input });
				break;
			case 'tool-result':
				events.push({
					type: 'tool-result',
					toolName: part.toolName,
					output: typeof part.output === 'string' ? part.output : JSON.stringify(part.output)
				});
				break;
			case 'finish':
				{
					const cacheReadTokens = part.totalUsage?.inputTokenDetails?.cacheReadTokens;
					const cacheWriteTokens = part.totalUsage?.inputTokenDetails?.cacheWriteTokens;
					events.push({
						type: 'finish',
						finishReason: part.finishReason ?? 'unknown',
						usage: {
							inputTokens:
								part.totalUsage?.inputTokenDetails?.noCacheTokens ?? part.totalUsage?.inputTokens,
							outputTokens: part.totalUsage?.outputTokens,
							reasoningTokens:
								part.totalUsage?.outputTokenDetails?.reasoningTokens ??
								part.totalUsage?.reasoningTokens,
							cachedTokens:
								cacheReadTokens != null || cacheWriteTokens != null
									? (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0)
									: part.totalUsage?.cachedInputTokens,
							cacheReadTokens,
							cacheWriteTokens,
							totalTokens: part.totalUsage?.totalTokens
						}
					});
				}
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
};

export async function* streamAgentLoop(options: AgentLoopOptions): AsyncGenerator<AgentEvent> {
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

	const model = await getModel(providerId, modelId, {
		providerOptions: mergedProviderOptions,
		allowMissingAuth: providerId === 'openai-compat'
	});

	const initialContext = await getInitialContext(collectionPath, vfsId);
	const messages: ModelMessage[] = [
		{
			role: 'user',
			content: `${initialContext}\n\nQuestion: ${question}`
		}
	];

	const tools = createTools(collectionPath, vfsId);
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

	for await (const part of result.fullStream) {
		switch (part.type) {
			case 'text-delta':
				yield { type: 'text-delta', text: part.text };
				break;
			case 'reasoning-delta':
				yield { type: 'reasoning-delta', text: part.text };
				break;
			case 'tool-call':
				yield { type: 'tool-call', toolName: part.toolName, input: part.input };
				break;
			case 'tool-result':
				yield {
					type: 'tool-result',
					toolName: part.toolName,
					output: typeof part.output === 'string' ? part.output : JSON.stringify(part.output)
				};
				break;
			case 'finish':
				{
					const cacheReadTokens = part.totalUsage?.inputTokenDetails?.cacheReadTokens;
					const cacheWriteTokens = part.totalUsage?.inputTokenDetails?.cacheWriteTokens;
					yield {
						type: 'finish',
						finishReason: part.finishReason ?? 'unknown',
						usage: {
							inputTokens:
								part.totalUsage?.inputTokenDetails?.noCacheTokens ?? part.totalUsage?.inputTokens,
							outputTokens: part.totalUsage?.outputTokens,
							reasoningTokens:
								part.totalUsage?.outputTokenDetails?.reasoningTokens ??
								part.totalUsage?.reasoningTokens,
							cachedTokens:
								cacheReadTokens != null || cacheWriteTokens != null
									? (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0)
									: part.totalUsage?.cachedInputTokens,
							cacheReadTokens,
							cacheWriteTokens,
							totalTokens: part.totalUsage?.totalTokens
						}
					};
				}
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
