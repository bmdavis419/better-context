export const WEB_SANDBOX_MODELS = [
	{
		id: 'minimax-m2.5',
		label: 'MiniMax M2.5',
		provider: 'opencode',
		tier: 'low',
		description: 'Lowest usage',
		ratesUsdPerMTokens: {
			input: 0.3,
			output: 1.2,
			cacheRead: 0.06
		}
	},
	{
		id: 'claude-haiku-4-5',
		label: 'Claude Haiku 4.5',
		provider: 'opencode',
		tier: 'medium',
		description: 'Balanced',
		ratesUsdPerMTokens: {
			input: 1,
			output: 5,
			cacheRead: 0.1,
			cacheWrite: 1.25
		}
	},
	{
		id: 'gpt-5.4',
		label: 'GPT-5.4',
		provider: 'opencode',
		tier: 'high',
		description: 'Highest usage',
		ratesUsdPerMTokens: {
			input: 2.5,
			output: 15,
			cacheRead: 0.25
		}
	}
] as const;

export type WebSandboxModel = (typeof WEB_SANDBOX_MODELS)[number];
export type WebSandboxModelId = WebSandboxModel['id'];

export const DEFAULT_WEB_SANDBOX_MODEL_ID: WebSandboxModelId = 'claude-haiku-4-5';

const WEB_SANDBOX_MODEL_BY_ID = new Map(
	WEB_SANDBOX_MODELS.map(
		(model) => [model.id, model] satisfies [WebSandboxModelId, WebSandboxModel]
	)
);

export const isWebSandboxModelId = (value: string): value is WebSandboxModelId =>
	WEB_SANDBOX_MODEL_BY_ID.has(value as WebSandboxModelId);

export const getWebSandboxModel = (modelId?: string | null) =>
	(modelId && isWebSandboxModelId(modelId)
		? WEB_SANDBOX_MODEL_BY_ID.get(modelId)
		: WEB_SANDBOX_MODEL_BY_ID.get(DEFAULT_WEB_SANDBOX_MODEL_ID))!;
