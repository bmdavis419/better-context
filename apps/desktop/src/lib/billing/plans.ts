import { PRO_AI_BUDGET_MICROS, PRO_AI_BUDGET_USD } from '@btca/convex/aiBudget';
import { WEB_SANDBOX_MODELS } from '@btca/convex/webSandboxModels';

export const BILLING_PLAN = {
	id: 'btca_pro',
	name: 'Pro',
	priceUsd: 8,
	interval: 'month',
	aiBudgetUsd: PRO_AI_BUDGET_USD,
	aiBudgetMicros: PRO_AI_BUDGET_MICROS,
	models: WEB_SANDBOX_MODELS.map(({ id, label, tier, description }) => ({
		id,
		label,
		tier,
		description
	}))
} as const;

export const FEATURE_IDS = {
	aiBudget: 'ai_budget',
	chatMessages: 'chat_messages'
} as const;

export const SUPPORT_URL = 'https://x.com/davis7';
