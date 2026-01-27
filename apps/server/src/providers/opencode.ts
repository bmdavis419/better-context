/**
 * OpenCode Zen Provider
 * Routes to appropriate endpoints based on model type
 *
 * OpenCode Zen is a gateway that provides access to curated models.
 * Each model type uses a specific endpoint and AI SDK:
 * - Claude models → `@ai-sdk/anthropic` → https://opencode.ai/zen/v1/messages
 * - GPT models → `@ai-sdk/openai` → https://opencode.ai/zen/v1/responses
 * - Gemini models → `@ai-sdk/google` → https://opencode.ai/zen/v1/models/{model}
 * - Others (GLM, Kimi, Qwen, Big Pickle) → `@ai-sdk/openai-compatible` → https://opencode.ai/zen/v1/chat/completions
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

// Zen API endpoints for each SDK type
// Note: Each SDK appends its own path segment to baseURL:
// - Anthropic SDK: appends /messages
// - OpenAI SDK responses: appends /responses
// - Google SDK: appends /models/{model}
// - OpenAI-compatible SDK: appends /chat/completions
// So we use the same base URL for all of them
const ZEN_BASE_URL = 'https://opencode.ai/zen/v1';

// Model prefixes and their corresponding provider types
const MODEL_ROUTING: Array<{
	prefix: string;
	type: 'anthropic' | 'openai' | 'google' | 'compatible';
}> = [
	{ prefix: 'claude-', type: 'anthropic' },
	{ prefix: 'gpt-', type: 'openai' },
	{ prefix: 'gemini-', type: 'google' },
	// Everything else uses openai-compatible
	{ prefix: 'glm-', type: 'compatible' },
	{ prefix: 'kimi-', type: 'compatible' },
	{ prefix: 'qwen', type: 'compatible' },
	{ prefix: 'big-pickle', type: 'compatible' }
];

/**
 * Determine which provider type to use for a model
 */
function getModelType(modelId: string): 'anthropic' | 'openai' | 'google' | 'compatible' {
	const lowerId = modelId.toLowerCase();

	for (const route of MODEL_ROUTING) {
		if (lowerId.startsWith(route.prefix)) {
			return route.type;
		}
	}

	// Default to openai-compatible for unknown models
	return 'compatible';
}

/**
 * Create an OpenCode Zen provider
 */
export function createOpenCodeZen(options: { apiKey: string }) {
	const { apiKey } = options;

	return function opencode(modelId: string): LanguageModel {
		const modelType = getModelType(modelId);

		switch (modelType) {
			case 'anthropic': {
				// Anthropic SDK appends /messages to baseURL
				const provider = createAnthropic({
					apiKey,
					baseURL: ZEN_BASE_URL
				});
				return provider(modelId);
			}

			case 'openai': {
				// OpenAI SDK .responses() appends /responses to baseURL
				const provider = createOpenAI({
					apiKey,
					baseURL: ZEN_BASE_URL
				});
				return provider.responses(modelId);
			}

			case 'google': {
				// Google SDK appends /models/{model} to baseURL
				const provider = createGoogleGenerativeAI({
					apiKey,
					baseURL: ZEN_BASE_URL
				});
				return provider(modelId);
			}

			case 'compatible':
			default: {
				// OpenAI-compatible SDK appends /chat/completions to baseURL
				const provider = createOpenAICompatible({
					name: 'opencode-zen',
					apiKey,
					baseURL: ZEN_BASE_URL
				});
				return provider.chatModel(modelId);
			}
		}
	};
}

/**
 * Available OpenCode Zen models
 */
export const OPENCODE_ZEN_MODELS = [
	// GPT models
	'gpt-5.2',
	'gpt-5.2-codex',
	'gpt-5.1',
	'gpt-5.1-codex',
	'gpt-5.1-codex-max',
	'gpt-5.1-codex-mini',
	'gpt-5',
	'gpt-5-codex',
	'gpt-5-nano',
	// Claude models
	'claude-sonnet-4-5',
	'claude-sonnet-4',
	'claude-haiku-4-5',
	'claude-3-5-haiku',
	'claude-opus-4-5',
	'claude-opus-4-1',
	// Gemini models
	'gemini-3-pro',
	'gemini-3-flash',
	// Other models
	'glm-4.7',
	'glm-4.6',
	'kimi-k2',
	'kimi-k2-thinking',
	'qwen3-coder',
	'big-pickle'
] as const;

export type OpenCodeZenModel = (typeof OPENCODE_ZEN_MODELS)[number];
