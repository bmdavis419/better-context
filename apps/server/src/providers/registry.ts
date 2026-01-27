/**
 * Provider Registry
 * Maps provider IDs to their AI SDK factory functions
 */
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createCerebras } from '@ai-sdk/cerebras';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepInfra } from '@ai-sdk/deepinfra';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createPerplexity } from '@ai-sdk/perplexity';
import { createTogetherAI } from '@ai-sdk/togetherai';
import { createXai } from '@ai-sdk/xai';

import { createOpenCodeZen } from './opencode.ts';

// Type for provider factory options
export type ProviderOptions = {
	apiKey?: string;
	baseURL?: string;
	headers?: Record<string, string>;
	name?: string; // Required for openai-compatible
};

// Type for a provider factory function
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProviderFactory = (options?: any) => {
	(modelId: string, settings?: Record<string, unknown>): unknown;
};

// Registry of all supported providers
export const PROVIDER_REGISTRY: Record<string, ProviderFactory> = {
	// OpenCode Zen (curated models gateway)
	opencode: createOpenCodeZen as ProviderFactory,

	// Anthropic
	anthropic: createAnthropic as ProviderFactory,

	// OpenAI
	openai: createOpenAI as ProviderFactory,

	// Google
	google: createGoogleGenerativeAI as ProviderFactory,
	'google-vertex': createVertex as ProviderFactory,

	// Amazon
	'amazon-bedrock': createAmazonBedrock as ProviderFactory,

	// Azure
	azure: createAzure as ProviderFactory,

	// Other providers
	groq: createGroq as ProviderFactory,
	mistral: createMistral as ProviderFactory,
	xai: createXai as ProviderFactory,
	cohere: createCohere as ProviderFactory,
	deepinfra: createDeepInfra as ProviderFactory,
	cerebras: createCerebras as ProviderFactory,
	perplexity: createPerplexity as ProviderFactory,
	togetherai: createTogetherAI as ProviderFactory,

	// OpenAI-compatible providers (for custom endpoints)
	'openai-compatible': createOpenAICompatible as ProviderFactory
};

// Provider aliases for common naming variations
export const PROVIDER_ALIASES: Record<string, string> = {
	claude: 'anthropic',
	'gpt-4': 'openai',
	'gpt-4o': 'openai',
	gemini: 'google',
	vertex: 'google-vertex',
	bedrock: 'amazon-bedrock',
	grok: 'xai',
	together: 'togetherai'
};

/**
 * Check if a provider is supported
 */
export function isProviderSupported(providerId: string): boolean {
	const normalized = PROVIDER_ALIASES[providerId] || providerId;
	return normalized in PROVIDER_REGISTRY;
}

/**
 * Get the normalized provider ID
 */
export function normalizeProviderId(providerId: string): string {
	return PROVIDER_ALIASES[providerId] || providerId;
}

/**
 * Get a provider factory by ID
 */
export function getProviderFactory(providerId: string): ProviderFactory | undefined {
	const normalized = normalizeProviderId(providerId);
	return PROVIDER_REGISTRY[normalized];
}

/**
 * Get all supported provider IDs
 */
export function getSupportedProviders(): string[] {
	return Object.keys(PROVIDER_REGISTRY);
}
