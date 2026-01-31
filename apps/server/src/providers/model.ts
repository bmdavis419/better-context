/**
 * Model Instantiation
 * Creates AI SDK models with authentication from OpenCode
 */
import type { LanguageModel } from 'ai';

import { Auth } from './auth.ts';
import {
	getProviderFactory,
	isProviderSupported,
	normalizeProviderId,
	type ProviderOptions
} from './registry.ts';

export namespace Model {
	export class ProviderNotFoundError extends Error {
		readonly _tag = 'ProviderNotFoundError';
		readonly providerId: string;

		constructor(providerId: string) {
			super(`Provider "${providerId}" is not supported`);
			this.providerId = providerId;
		}
	}

	export class ProviderNotAuthenticatedError extends Error {
		readonly _tag = 'ProviderNotAuthenticatedError';
		readonly providerId: string;

		constructor(providerId: string) {
			super(
				providerId === 'openrouter'
					? `Provider "${providerId}" is not authenticated. Set OPENROUTER_API_KEY to authenticate.`
					: `Provider "${providerId}" is not authenticated. Run 'opencode auth login' to authenticate.`
			);
			this.providerId = providerId;
		}
	}

	export type ModelOptions = {
		/** Additional provider options */
		providerOptions?: Partial<ProviderOptions>;
		/** Skip authentication check (useful for providers with wellknown auth) */
		skipAuth?: boolean;
	};

	/**
	 * Create an AI SDK model with authentication
	 *
	 * @param providerId - The provider ID (e.g., 'anthropic', 'openai')
	 * @param modelId - The model ID (e.g., 'claude-sonnet-4-20250514', 'gpt-4o')
	 * @param options - Additional options
	 * @returns The AI SDK language model
	 */
	export async function getModel(
		providerId: string,
		modelId: string,
		options: ModelOptions = {}
	): Promise<LanguageModel> {
		const normalizedProviderId = normalizeProviderId(providerId);

		// Check if provider is supported
		if (!isProviderSupported(normalizedProviderId)) {
			throw new ProviderNotFoundError(providerId);
		}

		// Get the provider factory
		const factory = getProviderFactory(normalizedProviderId);
		if (!factory) {
			throw new ProviderNotFoundError(providerId);
		}

		// Get authentication
		let apiKey: string | undefined;

		if (!options.skipAuth) {
			// Special handling for 'opencode' provider - check env var first
			if (normalizedProviderId === 'opencode') {
				apiKey = process.env.OPENCODE_API_KEY || (await Auth.getApiKey(normalizedProviderId));
			} else {
				apiKey = await Auth.getApiKey(normalizedProviderId);
				if (!apiKey) {
					throw new ProviderNotAuthenticatedError(providerId);
				}
			}
		}

		// Build provider options
		const providerOptions: ProviderOptions = {
			...options.providerOptions
		};

		if (apiKey) {
			providerOptions.apiKey = apiKey;
		}

		// Create the provider and get the model
		const provider = factory(providerOptions);
		const model = provider(modelId);

		return model as LanguageModel;
	}

	/**
	 * Check if a model can be used (provider is supported and authenticated)
	 */
	export async function canUseModel(providerId: string): Promise<boolean> {
		const normalizedProviderId = normalizeProviderId(providerId);

		if (!isProviderSupported(normalizedProviderId)) {
			return false;
		}

		// Special case: opencode gateway is always available
		if (normalizedProviderId === 'opencode') {
			return true;
		}

		return Auth.isAuthenticated(normalizedProviderId);
	}

	/**
	 * Get all available providers (supported and authenticated)
	 */
	export async function getAvailableProviders(): Promise<string[]> {
		const authenticatedProviders = await Auth.getAuthenticatedProviders();
		return authenticatedProviders.filter((provider) => isProviderSupported(provider));
	}
}
