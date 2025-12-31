type BlessedModel = {
	provider: string;
	model: string;
	description: string;
	isDefault: boolean;
	providerSetupUrl: string;
};

export const BLESSED_MODELS: BlessedModel[] = [
	{
		provider: 'anthropic',
		model: 'claude-haiku-4-5',
		description: 'Claude Haiku 4.5, no reasoning. I HIGHLY recommend this model.',
		providerSetupUrl: 'https://opencode.ai/docs/providers/#anthropic',
		isDefault: false
	},
	{
		provider: 'opencode',
		model: 'minimax-m2.1-free',
		description: 'Minimax M2.1: very fast, very cheap, pretty good',
		providerSetupUrl: 'https://opencode.ai/docs/zen',
		isDefault: false
	},
	{
		provider: 'opencode',
		model: 'glm-4.7-free',
		description: 'GLM 4.7 through opencode zen',
		providerSetupUrl: 'https://opencode.ai/docs/zen',
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
