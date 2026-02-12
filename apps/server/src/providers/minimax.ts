import { createMinimax } from 'vercel-minimax-ai-provider';

const DEFAULT_BASE_URL = 'https://api.minimax.io/anthropic/v1';

const readEnv = (key: string) => {
	const value = process.env[key];
	return value && value.trim().length > 0 ? value.trim() : undefined;
};

export const MINIMAX_MODELS = ['MiniMax-M2.1', 'MiniMax-M2.5'] as const;

export type MinimaxModel = (typeof MINIMAX_MODELS)[number];

export function createMinimaxProvider(
	options: {
		apiKey?: string;
		baseURL?: string;
		headers?: Record<string, string>;
	} = {}
) {
	const provider = createMinimax({
		apiKey: options.apiKey ?? readEnv('MINIMAX_API_KEY'),
		baseURL: options.baseURL ?? DEFAULT_BASE_URL,
		headers: options.headers
	});

	return (modelId: string) => provider(modelId);
}
