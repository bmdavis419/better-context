import { Autumn } from 'autumn-js';
import { v } from 'convex/values';

import type { Doc } from './_generated/dataModel.js';
import { internal } from './_generated/api.js';
import { action, type ActionCtx } from './_generated/server.js';
import { AnalyticsEvents } from './analyticsEvents.js';
import { instances } from './apiHelpers.js';
import { requireInstanceOwnershipAction } from './authHelpers.js';

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

type UsageMetricDisplay = {
	usedPct: number;
	remainingPct: number;
	isDepleted: boolean;
};

type BillingSummaryResult = {
	plan: 'pro' | 'free' | 'none';
	status: 'active' | 'trialing' | 'canceled' | 'none';
	currentPeriodEnd: number | undefined;
	canceledAt: number | undefined;
	customer: { name: null; email: null };
	paymentMethod: unknown;
	usage: {
		tokensIn: UsageMetricDisplay;
		tokensOut: UsageMetricDisplay;
		sandboxHours: UsageMetricDisplay;
	};
	freeMessages?: {
		used: number;
		total: number;
		remaining: number;
	};
};

type SessionResult = { url: string };

type SubscriptionPlan = 'pro' | 'free' | 'none';
type SubscriptionStatus = 'active' | 'trialing' | 'canceled' | 'none';
type SubscriptionSnapshot = {
	plan: SubscriptionPlan;
	status: SubscriptionStatus;
	productId?: string;
	currentPeriodEnd?: number | null;
	canceledAt?: number | null;
};

const SANDBOX_IDLE_MINUTES = 2;
const CHARS_PER_TOKEN = 4;
const FEATURE_IDS = {
	tokensIn: 'tokens_in',
	tokensOut: 'tokens_out',
	sandboxHours: 'sandbox_hours',
	chatMessages: 'chat_messages'
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
	products?: {
		id?: string;
		status?: string;
		current_period_end?: number | null;
		canceled_at?: number | null;
	}[];
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

function getSubscriptionSnapshot(
	activeProduct: {
		id: string;
		status?: string;
		current_period_end?: number | null;
		canceled_at?: number | null;
	} | null
): SubscriptionSnapshot {
	if (!activeProduct) {
		return { plan: 'none', status: 'none' };
	}

	const plan: SubscriptionPlan =
		activeProduct.id === 'btca_pro' ? 'pro' : activeProduct.id === 'free_plan' ? 'free' : 'none';
	const status: SubscriptionStatus = activeProduct.status
		? (activeProduct.status as SubscriptionStatus)
		: 'none';

	return {
		plan,
		status,
		productId: activeProduct.id,
		currentPeriodEnd: activeProduct.current_period_end ?? undefined,
		canceledAt: activeProduct.canceled_at ?? undefined
	};
}

async function syncSubscriptionState(
	ctx: ActionCtx,
	instance: Doc<'instances'>,
	snapshot: SubscriptionSnapshot
): Promise<void> {
	const previousPlan: SubscriptionPlan = instance.subscriptionPlan ?? 'none';
	const previousStatus: SubscriptionStatus = instance.subscriptionStatus ?? 'none';

	if (previousPlan === snapshot.plan && previousStatus === snapshot.status) {
		return;
	}

	await ctx.runMutation(instances.mutations.setSubscriptionState, {
		instanceId: instance._id,
		plan: snapshot.plan,
		status: snapshot.status,
		productId: snapshot.productId,
		currentPeriodEnd: snapshot.currentPeriodEnd ?? undefined,
		canceledAt: snapshot.canceledAt ?? undefined
	});

	const properties = {
		instanceId: instance._id,
		plan: snapshot.plan,
		status: snapshot.status,
		previousPlan,
		previousStatus,
		productId: snapshot.productId ?? null,
		currentPeriodEnd: snapshot.currentPeriodEnd ?? null,
		canceledAt: snapshot.canceledAt ?? null
	};

	const event =
		previousPlan !== 'pro' &&
		snapshot.plan === 'pro' &&
		(snapshot.status === 'active' || snapshot.status === 'trialing')
			? AnalyticsEvents.SUBSCRIPTION_CREATED
			: previousPlan === 'pro' && snapshot.plan !== 'pro'
				? AnalyticsEvents.SUBSCRIPTION_CANCELED
				: AnalyticsEvents.SUBSCRIPTION_UPDATED;

	await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
		distinctId: instance.clerkId,
		event,
		properties
	});
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
		const instance = await requireInstanceOwnershipAction(ctx, args.instanceId);

		const identity = await ctx.auth.getUserIdentity();
		const autumnCustomer = await getOrCreateCustomer({
			clerkId: instance.clerkId,
			email: identity?.email,
			name:
				identity?.name ??
				(identity?.givenName
					? `${identity.givenName} ${identity.familyName ?? ''}`.trim()
					: undefined)
		});
		const activeProduct = getActiveProduct(autumnCustomer.products);
		await syncSubscriptionState(ctx, instance, getSubscriptionSnapshot(activeProduct));
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
						chatMessagesBalance: chatMessages.balance
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

		return {
			ok: false,
			reason: 'subscription_required'
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
		const instance = await requireInstanceOwnershipAction(ctx, args.instanceId);

		const identity = await ctx.auth.getUserIdentity();
		const autumnCustomer = await getOrCreateCustomer({
			clerkId: instance.clerkId,
			email: identity?.email,
			name:
				identity?.name ??
				(identity?.givenName
					? `${identity.givenName} ${identity.familyName ?? ''}`.trim()
					: undefined)
		});

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

export const getBillingSummary = action({
	args: billingArgs,
	handler: async (ctx, args): Promise<BillingSummaryResult> => {
		const instance = await requireInstanceOwnershipAction(ctx, args.instanceId);

		const identity = await ctx.auth.getUserIdentity();
		const autumnCustomer = await getOrCreateCustomer({
			clerkId: instance.clerkId,
			email: identity?.email,
			name:
				identity?.name ??
				(identity?.givenName
					? `${identity.givenName} ${identity.familyName ?? ''}`.trim()
					: undefined)
		});
		const activeProduct = getActiveProduct(autumnCustomer.products);
		const isFreePlan = activeProduct?.id === 'free_plan';
		const isProPlan = activeProduct?.id === 'btca_pro';

		const plan = isProPlan ? 'pro' : isFreePlan ? 'free' : 'none';
		const status = activeProduct?.status
			? (activeProduct.status as 'active' | 'trialing' | 'canceled')
			: 'none';

		await syncSubscriptionState(ctx, instance, {
			plan,
			status,
			productId: activeProduct?.id ?? undefined,
			currentPeriodEnd: activeProduct?.current_period_end ?? undefined,
			canceledAt: activeProduct?.canceled_at ?? undefined
		});

		const [tokensIn, tokensOut, sandboxHours, chatMessages] = await Promise.all([
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
			}),
			checkFeature({
				customerId: autumnCustomer.id ?? instance.clerkId,
				featureId: FEATURE_IDS.chatMessages
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

		const result: BillingSummaryResult = {
			plan,
			status,
			currentPeriodEnd: activeProduct?.current_period_end ?? undefined,
			canceledAt: activeProduct?.canceled_at ?? undefined,
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

		if (isFreePlan) {
			result.freeMessages = {
				used: chatMessages.usage,
				total: chatMessages.included,
				remaining: chatMessages.balance
			};
		}

		return result;
	}
});

export const createCheckoutSession = action({
	args: {
		instanceId: v.id('instances'),
		baseUrl: v.string()
	},
	handler: async (ctx, args): Promise<SessionResult> => {
		const instance = await requireInstanceOwnershipAction(ctx, args.instanceId);

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.CHECKOUT_STARTED,
			properties: {
				instanceId: args.instanceId,
				plan: 'btca_pro'
			}
		});

		const identity = await ctx.auth.getUserIdentity();
		const autumnCustomer = await getOrCreateCustomer({
			clerkId: instance.clerkId,
			email: identity?.email,
			name:
				identity?.name ??
				(identity?.givenName
					? `${identity.givenName} ${identity.familyName ?? ''}`.trim()
					: undefined)
		});

		const autumn = getAutumnClient();
		const payload = await autumn.checkout({
			customer_id: autumnCustomer.id ?? instance.clerkId,
			product_id: 'btca_pro',
			success_url: `${args.baseUrl}/app/checkout/success`,
			checkout_session_params: {
				cancel_url: `${args.baseUrl}/app/checkout/cancel`
			}
		});
		if (payload.error) {
			throw new Error(payload.error.message ?? 'Failed to create checkout session');
		}
		if (payload.data?.url) {
			return { url: payload.data.url };
		}

		const attachPayload = await autumn.attach({
			customer_id: autumnCustomer.id ?? instance.clerkId,
			product_id: 'btca_pro',
			success_url: `${args.baseUrl}/app/checkout/success`
		});
		if (attachPayload.error) {
			throw new Error(attachPayload.error.message ?? 'Failed to attach checkout session');
		}

		return {
			url: attachPayload.data?.checkout_url ?? `${args.baseUrl}/app/checkout/success`
		};
	}
});

export const createBillingPortalSession = action({
	args: {
		instanceId: v.id('instances'),
		baseUrl: v.string()
	},
	handler: async (ctx, args): Promise<SessionResult> => {
		const instance = await requireInstanceOwnershipAction(ctx, args.instanceId);

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.BILLING_PORTAL_OPENED,
			properties: {
				instanceId: args.instanceId
			}
		});

		const identity = await ctx.auth.getUserIdentity();
		const autumnCustomer = await getOrCreateCustomer({
			clerkId: instance.clerkId,
			email: identity?.email,
			name:
				identity?.name ??
				(identity?.givenName
					? `${identity.givenName} ${identity.familyName ?? ''}`.trim()
					: undefined)
		});
		const autumn = getAutumnClient();
		const payload = await autumn.customers.billingPortal(autumnCustomer.id ?? instance.clerkId, {
			return_url: `${args.baseUrl}/app/settings/billing`
		});
		if (payload.error) {
			throw new Error(payload.error.message ?? 'Failed to create billing portal session');
		}

		return {
			url: payload.data?.url ?? `${args.baseUrl}/app/settings/billing`
		};
	}
});
