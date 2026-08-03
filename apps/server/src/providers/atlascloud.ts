import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const ATLAS_CLOUD_BASE_URL = 'https://api.atlascloud.ai/v1';

const readEnv = (key: string) => {
	const value = process.env[key];
	return value && value.trim().length > 0 ? value.trim() : undefined;
};

export function createAtlasCloud(
	options: {
		apiKey?: string;
		baseURL?: string;
		headers?: Record<string, string>;
		name?: string;
	} = {}
) {
	const provider = createOpenAICompatible({
		name: options.name ?? 'atlascloud',
		apiKey: options.apiKey ?? readEnv('ATLASCLOUD_API_KEY'),
		baseURL: options.baseURL ?? readEnv('ATLASCLOUD_BASE_URL') ?? ATLAS_CLOUD_BASE_URL,
		headers: options.headers
	});

	return (modelId: string) => provider.chatModel(modelId);
}
