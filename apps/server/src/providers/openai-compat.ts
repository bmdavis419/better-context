import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const createOpenAICompat = (
	options: {
		apiKey?: string;
		baseURL?: string;
		name?: string;
	} = {}
) => {
	const baseURL = options.baseURL?.trim();
	const name = options.name?.trim();

	if (!baseURL || !name) {
		throw new Error('openai-compat requires baseURL and name');
	}

	const provider = createOpenAICompatible({
		apiKey: options.apiKey,
		baseURL,
		name
	});

	return (modelId: string) => provider.chatModel(modelId);
};
