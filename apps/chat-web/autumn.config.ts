import { feature, product, featureItem, priceItem } from 'atmn';
import { BILLING_PLAN, FEATURE_IDS } from './src/lib/billing/plans.ts';

export const tokensIn = feature({
	id: FEATURE_IDS.tokensIn,
	name: 'Tokens In',
	type: 'single_use'
});

export const tokensOut = feature({
	id: FEATURE_IDS.tokensOut,
	name: 'Tokens Out',
	type: 'single_use'
});

export const sandboxHours = feature({
	id: FEATURE_IDS.sandboxHours,
	name: 'Sandbox Hours',
	type: 'single_use'
});

export const proPlan = product({
	id: BILLING_PLAN.id,
	name: `${BILLING_PLAN.name} Plan`,
	items: [
		priceItem({
			price: BILLING_PLAN.priceUsd,
			interval: BILLING_PLAN.interval
		}),
		featureItem({
			feature_id: tokensIn.id,
			included_usage: BILLING_PLAN.limits.tokensIn,
			interval: BILLING_PLAN.interval
		}),
		featureItem({
			feature_id: tokensOut.id,
			included_usage: BILLING_PLAN.limits.tokensOut,
			interval: BILLING_PLAN.interval
		}),
		featureItem({
			feature_id: sandboxHours.id,
			included_usage: BILLING_PLAN.limits.sandboxHours,
			interval: BILLING_PLAN.interval
		})
	]
});
