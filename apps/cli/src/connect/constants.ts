export const CURATED_MODELS: Record<string, { id: string; label: string }[]> = {
	atlascloud: [{ id: 'deepseek-ai/deepseek-v4-pro', label: 'DeepSeek V4 Pro' }],
	openai: [
		{ id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
		{ id: 'gpt-5.4', label: 'GPT-5.4' }
	],
	'github-copilot': [
		{ id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5' },
		{ id: 'grok-code-fast-1', label: 'Grok Code Fast 1' }
	],
	opencode: [
		{ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
		{ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
		{ id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
		{ id: 'glm-4.7', label: 'GLM 4.7' },
		{ id: 'kimi-k2.5', label: 'Kimi K2.5' },
		{ id: 'gpt-5.4', label: 'GPT-5.4' },
		{ id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' }
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
	google: [{ id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' }],
	minimax: [
		{ id: 'MiniMax-M2.5', label: 'MiniMax M2.5' },
		{ id: 'MiniMax-M2.1', label: 'MiniMax M2.1' }
	]
};

export const PROVIDER_INFO: Record<string, { label: string; requiresAuth: boolean }> = {
	atlascloud: { label: 'Atlas Cloud', requiresAuth: true },
	opencode: { label: 'OpenCode Zen', requiresAuth: true },
	'github-copilot': { label: 'GitHub Copilot', requiresAuth: true },
	anthropic: { label: 'Anthropic (Claude)', requiresAuth: true },
	openai: { label: 'OpenAI (GPT)', requiresAuth: true },
	'openai-compat': { label: 'OpenAI Compatible', requiresAuth: false },
	minimax: { label: 'MiniMax', requiresAuth: true },
	google: { label: 'Google (Gemini)', requiresAuth: true },
	openrouter: { label: 'OpenRouter', requiresAuth: true }
};

export const PROVIDER_AUTH_GUIDANCE: Record<string, string> = {
	atlascloud: 'Atlas Cloud uses API keys: paste your Atlas Cloud API key to continue.',
	'github-copilot': 'GitHub Copilot uses device flow OAuth: follow the browser prompt.',
	openai: 'OpenAI requires OAuth: btca will open a browser to sign in.',
	minimax: 'MiniMax uses API keys: paste your MiniMax API key to continue.',
	'openai-compat': 'Enter base URL, name, and model ID. API key is optional.',
	anthropic: 'Anthropic uses API keys: paste your API key to continue.',
	google: 'Google uses API keys: paste your API key to continue.',
	openrouter: 'OpenRouter uses API keys: paste your API key to continue.',
	opencode: 'OpenCode uses API keys: paste your API key to continue.'
};

export const PROVIDER_MODEL_DOCS: Record<string, { label: string; url: string }> = {
	atlascloud: {
		label: 'Model catalog',
		url: 'https://api.atlascloud.ai/api/v1/models'
	},
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
	},
	minimax: { label: 'Model docs', url: 'https://platform.minimax.io/docs/guides/text-generation' }
};

export const PROVIDER_MODEL_WARNINGS: Record<string, string> = {
	'github-copilot':
		'GitHub Copilot model availability is endpoint- and policy-dependent. Public model lists may include models that the Copilot chat API still rejects for your account, so if a selected model fails, try a different one or use Copilot as an experimental provider.'
};

export const PROVIDER_SETUP_LINKS: Record<string, { label: string; url: string }> = {
	atlascloud: {
		label: 'Get Atlas Cloud API key',
		url: 'https://www.atlascloud.ai/console/api-keys'
	},
	opencode: { label: 'Get OpenCode Zen API key', url: 'https://opencode.ai/zen' },
	minimax: {
		label: 'Get MiniMax API key',
		url: 'https://platform.minimax.io/user-center/basic-information'
	},
	openrouter: { label: 'Get OpenRouter API key', url: 'https://openrouter.ai/models' },
	google: { label: 'Get Google API key', url: 'https://aistudio.google.com/api-keys' },
	anthropic: { label: 'Get Anthropic API key', url: 'https://platform.claude.com/dashboard' }
};
