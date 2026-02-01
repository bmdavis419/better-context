// Re-export all thread-related types and functions
export * from './thread.ts';

// Re-export stream filtering utilities
export * from './stream-filter.ts';
export * from './resources.ts';

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
		model: 'claude-haiku-4-5',
		description: 'Claude Haiku 4.5 via OpenCode Zen (API key).',
		providerSetupUrl: 'https://opencode.ai/zen',
		isDefault: true
	},
	{
		provider: 'opencode',
		model: 'claude-sonnet-4-5',
		description: 'Claude Sonnet 4.5 via OpenCode Zen (API key).',
		providerSetupUrl: 'https://opencode.ai/zen',
		isDefault: false
	},
	{
		provider: 'opencode',
		model: 'gemini-3-flash',
		description: 'Gemini 3 Flash via OpenCode Zen (API key).',
		providerSetupUrl: 'https://opencode.ai/zen',
		isDefault: false
	},
	{
		provider: 'opencode',
		model: 'glm-4.7',
		description: 'GLM 4.7 via OpenCode Zen (API key).',
		providerSetupUrl: 'https://opencode.ai/zen',
		isDefault: false
	},
	{
		provider: 'opencode',
		model: 'kimi-k2.5',
		description: 'Kimi K2.5 via OpenCode Zen (API key).',
		providerSetupUrl: 'https://opencode.ai/zen',
		isDefault: false
	},
	{
		provider: 'opencode',
		model: 'gpt-5.2-codex',
		description: 'GPT-5.2 Codex via OpenCode Zen (API key).',
		providerSetupUrl: 'https://opencode.ai/zen',
		isDefault: false
	},
	{
		provider: 'openrouter',
		model: 'anthropic/claude-haiku-4.5',
		description: 'Claude Haiku 4.5 via OpenRouter (API key).',
		providerSetupUrl: 'https://openrouter.ai/settings/keys',
		isDefault: false
	},
	{
		provider: 'openrouter',
		model: 'openai/gpt-5.2-codex',
		description: 'GPT-5.2 Codex via OpenRouter (API key).',
		providerSetupUrl: 'https://openrouter.ai/settings/keys',
		isDefault: false
	},
	{
		provider: 'openrouter',
		model: 'minimax/minimax-m2.1',
		description: 'MiniMax M2.1 via OpenRouter (API key).',
		providerSetupUrl: 'https://openrouter.ai/settings/keys',
		isDefault: false
	},
	{
		provider: 'openrouter',
		model: 'moonshotai/kimi-k2.5',
		description: 'Moonshot Kimi K2.5 via OpenRouter (API key).',
		providerSetupUrl: 'https://openrouter.ai/settings/keys',
		isDefault: false
	},
	{
		provider: 'openai',
		model: 'gpt-5.2-codex',
		description: 'GPT-5.2 Codex (OAuth; uses your ChatGPT subscription).',
		providerSetupUrl: 'https://chatgpt.com',
		isDefault: false
	},
	{
		provider: 'anthropic',
		model: 'claude-haiku-4-5-20251001',
		description: 'Claude Haiku 4.5 (Anthropic API key).',
		providerSetupUrl: 'https://platform.claude.com/dashboard',
		isDefault: false
	},
	{
		provider: 'anthropic',
		model: 'claude-sonnet-4-5-20250929',
		description: 'Claude Sonnet 4.5 (Anthropic API key).',
		providerSetupUrl: 'https://platform.claude.com/dashboard',
		isDefault: false
	},
	{
		provider: 'google',
		model: 'gemini-3-flash-preview',
		description: 'Gemini 3 Flash Preview (Google API key).',
		providerSetupUrl: 'https://aistudio.google.com/api-keys',
		isDefault: false
	}
];
