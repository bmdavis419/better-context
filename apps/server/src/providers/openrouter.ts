import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

const readEnv = (key: string) => {
	const value = process.env[key];
	return value && value.trim().length > 0 ? value.trim() : undefined;
};

const buildHeaders = () => {
	const headers: Record<string, string> = {};
	const referer = readEnv('OPENROUTER_HTTP_REFERER');
	const title = readEnv('OPENROUTER_X_TITLE');

	if (referer) headers['HTTP-Referer'] = referer;
	if (title) headers['X-Title'] = title;

	return headers;
};

export function createOpenRouter(
	options: {
		apiKey?: string;
		baseURL?: string;
		headers?: Record<string, string>;
		name?: string;
	} = {}
) {
	const envHeaders = buildHeaders();
	const mergedHeaders = { ...envHeaders, ...(options.headers ?? {}) };
	const provider = createOpenAICompatible({
		name: options.name ?? 'openrouter',
		apiKey: options.apiKey,
		baseURL: options.baseURL ?? readEnv('OPENROUTER_BASE_URL') ?? DEFAULT_BASE_URL,
		headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined
	});

	return (modelId: string) => provider.chatModel(modelId);
}
