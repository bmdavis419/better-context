/**
 * Raycast-specific usage functions that don't rely on JWT authentication.
 * These are used by the Raycast HTTP endpoints which authenticate via API key.
 */
import { Autumn } from 'autumn-js';
import { v } from 'convex/values';

import { internal } from './_generated/api.js';
import { internalAction } from './_generated/server.js';
import { AnalyticsEvents } from './analyticsEvents.js';
import { instances } from './apiHelpers.js';

type FeatureMetrics = {
	usage: number;
	balance: number;
	included: number;
};

type UsageCheckResult =
	| { ok: false; reason: 'subscription_required' | 'free_limit_reached' }
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

const SANDBOX_IDLE_MINUTES = 2;
const CHARS_PER_TOKEN = 4;
const FEATURE_IDS = {
	tokensIn: 'tokens_in',
	tokensOut: 'tokens_out',
	sandboxHours: 'sandbox_hours',
	chatMessages: 'chat_messages'
} as const;

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

async function getOrCreateCustomerByClerkId(clerkId: string): Promise<{
	id: string;
	products?: {
		id?: string;
		status?: string;
		current_period_end?: number | null;
		canceled_at?: number | null;
	}[];
}> {
	const autumn = getAutumnClient();

	// Try to create customer first (will fail if already exists)
	const createPayload = await autumn.customers.create({
		id: clerkId
	});

	const fetchCustomer = async (customerId: string) => {
		const customerPayload = await autumn.customers.get(customerId);
		if (customerPayload.error) {
			throw new Error(customerPayload.error.message ?? 'Failed to fetch Autumn customer');
		}
		const id = customerPayload.data?.id ?? customerId;
		return {
			id,
			products: customerPayload.data?.products ?? []
		};
	};

	if (!createPayload.error) {
		const customerId = createPayload.data?.id ?? clerkId;
		return fetchCustomer(customerId);
	}

	const message = createPayload.error?.message ?? 'Failed to create Autumn customer';
	const alreadyExists = message.toLowerCase().includes('already');
	if (!alreadyExists) {
		throw new Error(message);
	}

	return fetchCustomer(clerkId);
}

function getActiveProduct(
	products:
		| {
				id?: string;
				status?: string;
				current_period_end?: number | null;
				canceled_at?: number | null;
		  }[]
		| undefined
): {
	id: string;
	status?: string;
	current_period_end?: number | null;
	canceled_at?: number | null;
} | null {
	if (!products?.length) return null;

	const proProduct = products.find(
		(product) =>
			product.id === 'btca_pro' && (product.status === 'active' || product.status === 'trialing')
	);
	if (proProduct) {
		return {
			id: proProduct.id ?? 'btca_pro',
			status: proProduct.status,
			current_period_end: proProduct.current_period_end,
			canceled_at: proProduct.canceled_at
		};
	}

	const freeProduct = products.find(
		(product) => product.id === 'free_plan' && product.status === 'active'
	);
	if (freeProduct) {
		return {
			id: freeProduct.id ?? 'free_plan',
			status: freeProduct.status,
			current_period_end: freeProduct.current_period_end,
			canceled_at: freeProduct.canceled_at
		};
	}

	return null;
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

/**
 * Check if usage is available for a Raycast request.
 * This is an internal action that doesn't require JWT auth.
 */
export const ensureUsageAvailableForRaycast = internalAction({
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

		// Use clerkId directly without JWT - we already verified ownership via API key
		const autumnCustomer = await getOrCreateCustomerByClerkId(instance.clerkId);
		const activeProduct = getActiveProduct(autumnCustomer.products);

		if (!activeProduct) {
			return {
				ok: false,
				reason: 'subscription_required'
			};
		}

		const isFreePlan = activeProduct.id === 'free_plan';
		const isProPlan = activeProduct.id === 'btca_pro';

		if (isFreePlan) {
			const chatMessages = await checkFeature({
				customerId: autumnCustomer.id ?? instance.clerkId,
				featureId: FEATURE_IDS.chatMessages,
				requiredBalance: 1
			});

			if (chatMessages.balance <= 0) {
				await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
					distinctId: instance.clerkId,
					event: AnalyticsEvents.USAGE_LIMIT_REACHED,
					properties: {
						instanceId: args.instanceId,
						limitTypes: ['chatMessages'],
						chatMessagesBalance: chatMessages.balance,
						source: 'raycast'
					}
				});

				return {
					ok: false,
					reason: 'free_limit_reached'
				};
			}

			return {
				ok: true,
				reason: null,
				metrics: {
					tokensIn: { usage: 0, balance: 0, included: 0 },
					tokensOut: { usage: 0, balance: 0, included: 0 },
					sandboxHours: { usage: 0, balance: 0, included: 0 }
				},
				inputTokens: 0,
				sandboxUsageHours: 0,
				customerId: autumnCustomer.id ?? instance.clerkId
			};
		}

		if (isProPlan) {
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
						sandboxHoursBalance: sandboxHours.balance,
						source: 'raycast'
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

		return {
			ok: false,
			reason: 'subscription_required'
		};
	}
});

/**
 * Finalize usage tracking for a Raycast request.
 * This is an internal action that doesn't require JWT auth.
 */
export const finalizeUsageForRaycast = internalAction({
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

		// Use clerkId directly without JWT
		const autumnCustomer = await getOrCreateCustomerByClerkId(instance.clerkId);
		const activeProduct = getActiveProduct(autumnCustomer.products);
		const isFreePlan = activeProduct?.id === 'free_plan';
		const isProPlan = activeProduct?.id === 'btca_pro';

		const tasks: Promise<void>[] = [];

		if (isFreePlan) {
			tasks.push(
				trackUsage({
					customerId: autumnCustomer.id ?? instance.clerkId,
					featureId: FEATURE_IDS.chatMessages,
					value: 1
				})
			);
		}

		const outputTokens = isProPlan
			? estimateTokensFromChars(args.outputChars + args.reasoningChars)
			: 0;
		const sandboxUsageHours = isProPlan ? (args.sandboxUsageHours ?? 0) : 0;

		if (isProPlan) {
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
		}

		await Promise.all(tasks);

		return {
			outputTokens,
			sandboxUsageHours,
			customerId: autumnCustomer.id ?? instance.clerkId
		};
	}
});
