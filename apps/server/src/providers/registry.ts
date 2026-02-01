/**
 * Provider Registry
 * Maps provider IDs to their AI SDK factory functions
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

import { createOpenCodeZen } from './opencode.ts';
import { createOpenAICodex } from './openai.ts';
import { createOpenRouter } from './openrouter.ts';

// Type for provider factory options
export type ProviderOptions = {
	apiKey?: string;
	accountId?: string;
	baseURL?: string;
	headers?: Record<string, string>;
	name?: string; // Required for openai-compatible
	instructions?: string;
	sessionId?: string;
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
	openai: createOpenAICodex as ProviderFactory,
	// Google
	google: createGoogleGenerativeAI as ProviderFactory,

	// OpenRouter (OpenAI-compatible gateway)
	openrouter: createOpenRouter as ProviderFactory
};

/**
 * Check if a provider is supported
 */
export function isProviderSupported(providerId: string): boolean {
	return providerId in PROVIDER_REGISTRY;
}

/**
 * Get the normalized provider ID
 */
export function normalizeProviderId(providerId: string): string {
	return providerId;
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
