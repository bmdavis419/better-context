type BlessedModel = {
	provider: string;
	model: string;
	description: string;
	isDefault: boolean;
	providerSetupUrl: string;
};

export const BLESSED_MODELS: BlessedModel[] = [
	{
		provider: 'opencode',
		model: 'btca-gemini-3-flash',
		description:
			'Gemini 3 Flash with low reasoning (the special btca version is already configured for you in btca)',
		providerSetupUrl: 'https://opencode.ai/docs/providers/#opencode-zen',
		isDefault: false
	},
	{
		provider: 'anthropic',
		model: 'claude-haiku-4-5',
		description: 'Claude Haiku 4.5, no reasoning',
		providerSetupUrl: 'https://opencode.ai/docs/providers/#anthropic',
		isDefault: false
	},
	{
		provider: 'opencode',
		model: 'big-pickle',
		description: 'Big Pickle, surprisingly good (and free)',
		providerSetupUrl: 'https://opencode.ai/docs/providers/#opencode-zen',
		isDefault: true
	},
	{
		provider: 'opencode',
		model: 'kimi-k2',
		description: 'Kimi K2, no reasoning',
		providerSetupUrl: 'https://opencode.ai/docs/providers/#opencode-zen',
		isDefault: false
	}
];
