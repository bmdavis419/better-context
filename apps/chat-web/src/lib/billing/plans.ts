export const BILLING_PLAN = {
	id: 'btca_pro',
	name: 'Pro',
	priceUsd: 8,
	interval: 'month',
	model: 'claude-haiku-4-5',
	limits: {
		tokensIn: 1_500_000,
		tokensOut: 300_000,
		sandboxHours: 6
	}
} as const;

export const FEATURE_IDS = {
	tokensIn: 'tokens_in',
	tokensOut: 'tokens_out',
	sandboxHours: 'sandbox_hours'
} as const;

export const SUPPORT_URL = 'https://x.com/davis7';
