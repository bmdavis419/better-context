import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const DEFAULT_BASE_URL = 'https://api.cursor.sh/v1';

const readEnv = (key: string) => {
	const value = process.env[key];
	return value && value.trim().length > 0 ? value.trim() : undefined;
};

export function createCursor(
	options: {
		apiKey?: string;
		baseURL?: string;
		headers?: Record<string, string>;
		name?: string;
	} = {}
) {
	const provider = createOpenAICompatible({
		name: options.name ?? 'cursor',
		apiKey: options.apiKey,
		baseURL: options.baseURL ?? readEnv('CURSOR_BASE_URL') ?? DEFAULT_BASE_URL,
		headers: options.headers
	});

	return (modelId: string) => provider.chatModel(modelId);
}
