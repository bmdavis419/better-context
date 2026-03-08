import { getWebSandboxModel } from '../models/webSandboxModels.ts';

export const USD_MICROS_PER_USD = 1_000_000;
export const PRO_AI_BUDGET_USD = 5;
export const PRO_AI_BUDGET_MICROS = PRO_AI_BUDGET_USD * USD_MICROS_PER_USD;

const toUsdMicros = (usd?: number) => (usd == null ? 0 : Math.round(usd * USD_MICROS_PER_USD));

const costPartMicros = (tokens: number, usdPerMTokens?: number) => {
	if (tokens <= 0 || usdPerMTokens == null) return 0;
	return Math.max(1, Math.round((tokens * toUsdMicros(usdPerMTokens)) / 1_000_000));
};

export const totalAiBudgetMicros = (args: {
	modelId?: string | null;
	inputTokens?: number;
	outputTokens?: number;
	reasoningTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
}) => {
	const model = getWebSandboxModel(args.modelId);
	const outputTokens = (args.outputTokens ?? 0) + (args.reasoningTokens ?? 0);
	const cacheWriteRate =
		'cacheWrite' in model.ratesUsdPerMTokens ? model.ratesUsdPerMTokens.cacheWrite : undefined;

	return (
		costPartMicros(args.inputTokens ?? 0, model.ratesUsdPerMTokens.input) +
		costPartMicros(outputTokens, model.ratesUsdPerMTokens.output) +
		costPartMicros(args.cacheReadTokens ?? 0, model.ratesUsdPerMTokens.cacheRead) +
		costPartMicros(args.cacheWriteTokens ?? 0, cacheWriteRate)
	);
};

export const getPreflightAiBudgetMicros = (args: {
	modelId?: string | null;
	inputTokens?: number;
}) =>
	totalAiBudgetMicros({
		modelId: args.modelId,
		inputTokens: args.inputTokens,
		outputTokens: 1
	});
