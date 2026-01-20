import { Autumn } from 'autumn-js';
import { v } from 'convex/values';

import { internal } from './_generated/api.js';
import { action } from './_generated/server.js';
import { AnalyticsEvents } from './analyticsEvents.js';
import { instances } from './apiHelpers.js';

type FeatureMetrics = {
	usage: number;
	balance: number;
	included: number;
};

type UsageCheckResult =
	| { ok: false; reason: 'subscription_required' }
	| {
			ok: boolean;
			reason: string | null;
			metrics: {
				tokensIn: FeatureMetrics;
				tokensOut: FeatureMetrics;
				sandboxHours: FeatureMetrics;
			};
			inputTokens: number;
			sandboxUsageHours: number;
			customerId: string;
	  };

type FinalizeUsageResult = {
	outputTokens: number;
	sandboxUsageHours: number;
	customerId: string;
};

type UsageMetricDisplay = {
	usedPct: number;
	remainingPct: number;
	isDepleted: boolean;
};

type BillingSummaryResult = {
	plan: 'pro' | 'none';
	status: 'active' | 'trialing' | 'canceled' | 'none';
	currentPeriodEnd: number | undefined;
	customer: { name: null; email: null };
	paymentMethod: unknown;
	usage: {
		tokensIn: UsageMetricDisplay;
		tokensOut: UsageMetricDisplay;
		sandboxHours: UsageMetricDisplay;
	};
};

type SessionResult = { url: string };

const SANDBOX_IDLE_MINUTES = 2;
const CHARS_PER_TOKEN = 4;
const FEATURE_IDS = {
	tokensIn: 'tokens_in',
	tokensOut: 'tokens_out',
	sandboxHours: 'sandbox_hours'
} as const;

const billingArgs = { instanceId: v.id('instances') };

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is not set in the Convex environment`);
	}
	return value;
}

let autumnClient: Autumn | null = null;

function getAutumnClient(): Autumn {
	if (!autumnClient) {
		autumnClient = new Autumn({ secretKey: requireEnv('AUTUMN_SECRET_KEY') });
	}
	return autumnClient;
}

function estimateTokensFromText(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	return Math.max(1, Math.ceil(trimmed.length / CHARS_PER_TOKEN));
}

function estimateTokensFromChars(chars: number): number {
	if (!Number.isFinite(chars) || chars <= 0) return 0;
	return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
}

function estimateSandboxUsageHours(params: { lastActiveAt?: number | null; now: number }): number {
	const maxWindowMs = SANDBOX_IDLE_MINUTES * 60 * 1000;
	if (!params.lastActiveAt) {
		return maxWindowMs / (60 * 60 * 1000);
	}
	const deltaMs = Math.max(0, params.now - params.lastActiveAt);
	const cappedMs = Math.min(deltaMs, maxWindowMs);
	return cappedMs / (60 * 60 * 1000);
}

function clampPercent(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

async function getOrCreateCustomer(user: {
	clerkId: string;
	email?: string | null;
	name?: string | null;
}): Promise<{
	id: string;
	products?: { id?: string; status?: string; current_period_end?: number | null }[];
	payment_method?: unknown;
}> {
	const autumn = getAutumnClient();
	const createPayload = await autumn.customers.create({
		id: user.clerkId,
		email: user.email ?? undefined,
		name: user.name ?? undefined
	});

	const fetchCustomer = async (customerId: string) => {
		const customerPayload = await autumn.customers.get(customerId, {
			expand: ['payment_method']
		});
		if (customerPayload.error) {
			throw new Error(customerPayload.error.message ?? 'Failed to fetch Autumn customer');
		}
		const id = customerPayload.data?.id ?? customerId;
		return {
			id,
			products: customerPayload.data?.products ?? [],
			payment_method: customerPayload.data?.payment_method
		};
	};

	if (!createPayload.error) {
		const customerId = createPayload.data?.id ?? user.clerkId;
		return fetchCustomer(customerId);
	}

	const message = createPayload.error?.message ?? 'Failed to create Autumn customer';
	const alreadyExists = message.toLowerCase().includes('already');
	if (!alreadyExists) {
		throw new Error(message);
	}

	return fetchCustomer(user.clerkId);
}

function getActiveProduct(
	products: { id?: string; status?: string; current_period_end?: number | null }[] | undefined
) {
	if (!products?.length) return null;
	return (
		products.find(
			(product) =>
				product.id === 'btca_pro' && (product.status === 'active' || product.status === 'trialing')
		) ?? null
	);
}

async function checkFeature(args: {
	customerId: string;
	featureId: string;
	requiredBalance?: number;
}): Promise<{ usage: number; balance: number; included: number }> {
	const autumn = getAutumnClient();
	const payload: {
		customer_id: string;
		feature_id: string;
		required_balance?: number;
	} = {
		customer_id: args.customerId,
		feature_id: args.featureId
	};
	if (args.requiredBalance !== undefined) {
		payload.required_balance = args.requiredBalance;
	}

	const result = await autumn.check(payload);
	if (result.error) {
		throw new Error(result.error.message ?? 'Failed to check Autumn usage');
	}

	return {
		usage: result.data?.usage ?? 0,
		balance: result.data?.balance ?? 0,
		included: result.data?.included_usage ?? 0
	};
}

async function trackUsage(args: {
	customerId: string;
	featureId: string;
	value: number;
}): Promise<void> {
	const autumn = getAutumnClient();
	const result = await autumn.track({
		customer_id: args.customerId,
		feature_id: args.featureId,
		value: args.value
	});
	if (result.error) {
		throw new Error(result.error.message ?? 'Failed to track Autumn usage');
	}
}

export const ensureUsageAvailable = action({
	args: {
		instanceId: v.id('instances'),
		question: v.string(),
		resources: v.array(v.string())
	},
	handler: async (ctx, args): Promise<UsageCheckResult> => {
		const instance = await ctx.runQuery(instances.queries.get, { id: args.instanceId });
		if (!instance) {
			throw new Error('Instance not found');
		}

		const autumnCustomer = await getOrCreateCustomer({
			clerkId: instance.clerkId
		});
		const activeProduct = getActiveProduct(autumnCustomer.products);
		if (!activeProduct) {
			return {
				ok: false,
				reason: 'subscription_required'
			};
		}

		const inputTokens = estimateTokensFromText(args.question);
		const now = Date.now();
		const sandboxUsageHours = args.resources.length
			? estimateSandboxUsageHours({ lastActiveAt: instance.lastActiveAt, now })
			: 0;

		const requiredTokensIn = inputTokens > 0 ? inputTokens : undefined;
		const requiredTokensOut = 1;
		const requiredSandboxHours = sandboxUsageHours > 0 ? sandboxUsageHours : undefined;

		const [tokensIn, tokensOut, sandboxHours] = await Promise.all([
			checkFeature({
				customerId: autumnCustomer.id ?? instance.clerkId,
				featureId: FEATURE_IDS.tokensIn,
				requiredBalance: requiredTokensIn
			}),
			checkFeature({
				customerId: autumnCustomer.id ?? instance.clerkId,
				featureId: FEATURE_IDS.tokensOut,
				requiredBalance: requiredTokensOut
			}),
			checkFeature({
				customerId: autumnCustomer.id ?? instance.clerkId,
				featureId: FEATURE_IDS.sandboxHours,
				requiredBalance: requiredSandboxHours
			})
		]);

		const hasEnough = (balance: number, required?: number) =>
			required == null ? balance > 0 : balance >= required;

		const ok =
			hasEnough(tokensIn.balance, requiredTokensIn) &&
			hasEnough(tokensOut.balance, requiredTokensOut) &&
			hasEnough(sandboxHours.balance, requiredSandboxHours);

		if (!ok) {
			const limitTypes: string[] = [];
			if (!hasEnough(tokensIn.balance, requiredTokensIn)) limitTypes.push('tokensIn');
			if (!hasEnough(tokensOut.balance, requiredTokensOut)) limitTypes.push('tokensOut');
			if (!hasEnough(sandboxHours.balance, requiredSandboxHours)) limitTypes.push('sandboxHours');

			await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
				distinctId: instance.clerkId,
				event: AnalyticsEvents.USAGE_LIMIT_REACHED,
				properties: {
					instanceId: args.instanceId,
					limitTypes,
					tokensInBalance: tokensIn.balance,
					tokensOutBalance: tokensOut.balance,
					sandboxHoursBalance: sandboxHours.balance
				}
			});
		}

		return {
			ok,
			reason: ok ? null : 'limit_reached',
			metrics: {
				tokensIn,
				tokensOut,
				sandboxHours
			},
			inputTokens,
			sandboxUsageHours,
			customerId: autumnCustomer.id ?? instance.clerkId
		};
	}
});

export const finalizeUsage = action({
	args: {
		instanceId: v.id('instances'),
		questionTokens: v.number(),
		outputChars: v.number(),
		reasoningChars: v.number(),
		resources: v.array(v.string()),
		sandboxUsageHours: v.optional(v.number())
	},
	handler: async (ctx, args): Promise<FinalizeUsageResult> => {
		const instance = await ctx.runQuery(instances.queries.get, { id: args.instanceId });
		if (!instance) {
			throw new Error('Instance not found');
		}

		const autumnCustomer = await getOrCreateCustomer({
			clerkId: instance.clerkId
		});

		const outputTokens = estimateTokensFromChars(args.outputChars + args.reasoningChars);
		const sandboxUsageHours = args.sandboxUsageHours ?? 0;

		const tasks: Promise<void>[] = [];
		if (args.questionTokens > 0) {
			tasks.push(
				trackUsage({
					customerId: autumnCustomer.id ?? instance.clerkId,
					featureId: FEATURE_IDS.tokensIn,
					value: args.questionTokens
				})
			);
		}
		if (outputTokens > 0) {
			tasks.push(
				trackUsage({
					customerId: autumnCustomer.id ?? instance.clerkId,
					featureId: FEATURE_IDS.tokensOut,
					value: outputTokens
				})
			);
		}
		if (sandboxUsageHours > 0) {
			tasks.push(
				trackUsage({
					customerId: autumnCustomer.id ?? instance.clerkId,
					featureId: FEATURE_IDS.sandboxHours,
					value: sandboxUsageHours
				})
			);
		}

		await Promise.all(tasks);

		return {
			outputTokens,
			sandboxUsageHours,
			customerId: autumnCustomer.id ?? instance.clerkId
		};
	}
});

export const getBillingSummary = action({
	args: billingArgs,
	handler: async (ctx, args): Promise<BillingSummaryResult> => {
		const instance = await ctx.runQuery(instances.queries.get, { id: args.instanceId });
		if (!instance) {
			throw new Error('Instance not found');
		}

		const autumnCustomer = await getOrCreateCustomer({
			clerkId: instance.clerkId
		});
		const activeProduct = getActiveProduct(autumnCustomer.products);
		const plan = activeProduct ? 'pro' : 'none';
		const status = activeProduct?.status
			? (activeProduct.status as 'active' | 'trialing' | 'canceled')
			: 'none';

		const [tokensIn, tokensOut, sandboxHours] = await Promise.all([
			checkFeature({
				customerId: autumnCustomer.id ?? instance.clerkId,
				featureId: FEATURE_IDS.tokensIn
			}),
			checkFeature({
				customerId: autumnCustomer.id ?? instance.clerkId,
				featureId: FEATURE_IDS.tokensOut
			}),
			checkFeature({
				customerId: autumnCustomer.id ?? instance.clerkId,
				featureId: FEATURE_IDS.sandboxHours
			})
		]);

		const toUsageMetric = (args: { usage: number; included: number; balance: number }) => {
			const usedPct = args.included > 0 ? clampPercent((args.usage / args.included) * 100) : 0;
			const remainingPct = clampPercent(100 - usedPct);
			return {
				usedPct,
				remainingPct,
				isDepleted: remainingPct <= 0 || args.balance <= 0
			};
		};

		return {
			plan,
			status,
			currentPeriodEnd: activeProduct?.current_period_end ?? undefined,
			customer: {
				name: null,
				email: null
			},
			paymentMethod: autumnCustomer.payment_method ?? null,
			usage: {
				tokensIn: toUsageMetric(tokensIn),
				tokensOut: toUsageMetric(tokensOut),
				sandboxHours: toUsageMetric(sandboxHours)
			}
		};
	}
});

export const createCheckoutSession = action({
	args: {
		instanceId: v.id('instances'),
		baseUrl: v.string()
	},
	handler: async (ctx, args): Promise<SessionResult> => {
		const instance = await ctx.runQuery(instances.queries.get, { id: args.instanceId });
		if (!instance) {
			throw new Error('Instance not found');
		}

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.CHECKOUT_STARTED,
			properties: {
				instanceId: args.instanceId,
				plan: 'btca_pro'
			}
		});

		const autumnCustomer = await getOrCreateCustomer({
			clerkId: instance.clerkId
		});

		const autumn = getAutumnClient();
		const payload = await autumn.checkout({
			customer_id: autumnCustomer.id ?? instance.clerkId,
			product_id: 'btca_pro',
			success_url: `${args.baseUrl}/checkout/success`,
			checkout_session_params: {
				cancel_url: `${args.baseUrl}/checkout/cancel`
			}
		});
		if (payload.error) {
			throw new Error(payload.error.message ?? 'Failed to create checkout session');
		}
		if (payload.data?.url) {
			await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
				distinctId: instance.clerkId,
				event: AnalyticsEvents.SUBSCRIPTION_CREATED,
				properties: {
					instanceId: args.instanceId,
					plan: 'btca_pro',
					wasExistingCustomer: true
				}
			});
			return { url: payload.data.url };
		}

		const attachPayload = await autumn.attach({
			customer_id: autumnCustomer.id ?? instance.clerkId,
			product_id: 'btca_pro',
			success_url: `${args.baseUrl}/checkout/success`
		});
		if (attachPayload.error) {
			throw new Error(attachPayload.error.message ?? 'Failed to attach checkout session');
		}

		return {
			url: attachPayload.data?.checkout_url ?? `${args.baseUrl}/checkout/success`
		};
	}
});

export const createBillingPortalSession = action({
	args: {
		instanceId: v.id('instances'),
		baseUrl: v.string()
	},
	handler: async (ctx, args): Promise<SessionResult> => {
		const instance = await ctx.runQuery(instances.queries.get, { id: args.instanceId });
		if (!instance) {
			throw new Error('Instance not found');
		}

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.BILLING_PORTAL_OPENED,
			properties: {
				instanceId: args.instanceId
			}
		});

		const autumnCustomer = await getOrCreateCustomer({
			clerkId: instance.clerkId
		});
		const autumn = getAutumnClient();
		const payload = await autumn.customers.billingPortal(autumnCustomer.id ?? instance.clerkId, {
			return_url: `${args.baseUrl}/settings/billing`
		});
		if (payload.error) {
			throw new Error(payload.error.message ?? 'Failed to create billing portal session');
		}

		return {
			url: payload.data?.url ?? `${args.baseUrl}/settings/billing`
		};
	}
});
