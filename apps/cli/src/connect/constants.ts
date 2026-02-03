export const CURATED_MODELS: Record<string, { id: string; label: string }[]> = {
	openai: [{ id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' }],
	'github-copilot': [
		{ id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
		{ id: 'grok-code-fast-1', label: 'Grok Code Fast 1' },
		{ id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' }
	],
	opencode: [
		{ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
		{ id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
		{ id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
		{ id: 'glm-4.7', label: 'GLM 4.7' },
		{ id: 'kimi-k2.5', label: 'Kimi K2.5' },
		{ id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' }
	],
	openrouter: [
		{ id: 'anthropic/claude-haiku-4.5', label: 'Anthropic Claude Haiku 4.5' },
		{ id: 'openai/gpt-5.2-codex', label: 'OpenAI GPT-5.2 Codex' },
		{ id: 'google/gemini-3-flash-preview', label: 'Google Gemini 3 Flash Preview' },
		{ id: 'minimax/minimax-m2.1', label: 'MiniMax M2.1' },
		{ id: 'moonshotai/kimi-k2.5', label: 'Moonshot Kimi K2.5' }
	],
	anthropic: [
		{ id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (2025-10-01)' },
		{ id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5 (2025-09-29)' }
	],
	google: [{ id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' }]
};

export const PROVIDER_INFO: Record<string, { label: string; requiresAuth: boolean }> = {
	opencode: { label: 'OpenCode Zen', requiresAuth: true },
	'github-copilot': { label: 'GitHub Copilot', requiresAuth: true },
	anthropic: { label: 'Anthropic (Claude)', requiresAuth: true },
	openai: { label: 'OpenAI (GPT)', requiresAuth: true },
	'openai-compat': { label: 'OpenAI Compatible', requiresAuth: false },
	google: { label: 'Google (Gemini)', requiresAuth: true },
	openrouter: { label: 'OpenRouter', requiresAuth: true }
};

export const PROVIDER_AUTH_GUIDANCE: Record<string, string> = {
	'github-copilot': 'GitHub Copilot uses device flow OAuth: follow the browser prompt.',
	openai: 'OpenAI requires OAuth: btca will open a browser to sign in.',
	'openai-compat': 'Enter base URL, name, and model ID. API key is optional.',
	anthropic: 'Anthropic uses API keys: paste your API key to continue.',
	google: 'Google uses API keys: paste your API key to continue.',
	openrouter: 'OpenRouter uses API keys: paste your API key to continue.',
	opencode: 'OpenCode uses API keys: paste your API key to continue.'
};

export const PROVIDER_MODEL_DOCS: Record<string, { label: string; url: string }> = {
	openai: { label: 'Model docs', url: 'https://platform.openai.com/docs/models' },
	'openai-compat': {
		label: 'OpenAI-compatible docs',
		url: 'https://ai-sdk.dev/providers/openai-compatible-providers/lmstudio#lm-studio-provider'
	},
	anthropic: {
		label: 'Model docs',
		url: 'https://platform.claude.com/docs/en/about-claude/models/overview'
	},
	opencode: { label: 'Model docs', url: 'https://opencode.ai/docs/zen/#endpoints' },
	openrouter: { label: 'Model docs', url: 'https://openrouter.ai/models' },
	google: { label: 'Model docs', url: 'https://ai.google.dev/gemini-api/docs' },
	'github-copilot': {
		label: 'Model docs',
		url: 'https://docs.github.com/en/rest/models?apiVersion=2022-11-28'
	}
};

export const PROVIDER_SETUP_LINKS: Record<string, { label: string; url: string }> = {
	opencode: { label: 'Get OpenCode Zen API key', url: 'https://opencode.ai/zen' },
	openrouter: { label: 'Get OpenRouter API key', url: 'https://openrouter.ai/models' },
	google: { label: 'Get Google API key', url: 'https://aistudio.google.com/api-keys' },
	anthropic: { label: 'Get Anthropic API key', url: 'https://platform.claude.com/dashboard' }
};
