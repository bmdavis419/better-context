import { Autumn } from 'autumn-js';
import { v } from 'convex/values';
import { Result } from 'better-result';

import type { Doc } from './_generated/dataModel.js';
import { internal } from './_generated/api.js';
import { action, type ActionCtx } from './_generated/server.js';
import { AnalyticsEvents } from './analyticsEvents.js';
import { instances } from './apiHelpers.js';
import { requireInstanceOwnershipActionResult, unwrapAuthResult } from './authHelpers.js';
import {
	WebConfigMissingError,
	WebExternalDependencyError,
	WebUnhandledError,
	type WebError
} from '../lib/result/errors.js';

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
type UsageResult<T> = Result<T, WebError>;

const toExternalError = <T>(
	error: unknown,
	fallbackMessage: string,
	dependency: string
): UsageResult<T> => {
	if (error instanceof WebUnhandledError || error instanceof WebExternalDependencyError) {
		return Result.err(error);
	}
	if (error instanceof Error) {
		return Result.err(new WebUnhandledError({ message: error.message, cause: error }));
	}
	return Result.err(new WebExternalDependencyError({ message: fallbackMessage, dependency }));
};

function requireEnvResult(name: string): UsageResult<string> {
	const value = process.env[name];
	if (!value) {
		return Result.err(
			new WebConfigMissingError({ message: `${name} is not set in the environment`, config: name })
		);
	}
	return Result.ok(value);
}

let autumnClient: Autumn | null = null;

function getAutumnClientResult(): UsageResult<Autumn> {
	if (!autumnClient) {
		const apiKeyResult = requireEnvResult('AUTUMN_SECRET_KEY');
		if (Result.isError(apiKeyResult)) {
			return Result.err(apiKeyResult.error);
		}
		autumnClient = new Autumn({ secretKey: apiKeyResult.value });
	}
	return Result.ok(autumnClient);
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

type AutumnCustomer = {
	id: string;
	products?: {
		id?: string;
		status?: string;
		current_period_end?: number | null;
		canceled_at?: number | null;
	}[];
	payment_method?: unknown;
};

const throwUsageError = (error: WebError): never => {
	throw error;
};

const unwrapUsage = <T>(result: UsageResult<T>): T => {
	return Result.match(result, {
		ok: (value) => value,
		err: (error) => throwUsageError(error)
	});
};

async function getOrCreateCustomer(user: {
	clerkId: string;
	email?: string | null;
	name?: string | null;
}): Promise<UsageResult<AutumnCustomer>> {
	const autumnResult = getAutumnClientResult();
	if (Result.isError(autumnResult)) {
		return Result.err(autumnResult.error);
	}

	const autumn = autumnResult.value;

	const fetchCustomer = async (customerId: string): Promise<UsageResult<AutumnCustomer>> => {
		try {
			const customerPayload = await autumn.customers.get(customerId, {
				expand: ['payment_method']
			});
			if (customerPayload.error) {
				return Result.err(
					new WebExternalDependencyError({
						message: customerPayload.error.message ?? 'Failed to fetch Autumn customer',
						dependency: 'Autumn'
					})
				);
			}
			const id = customerPayload.data?.id ?? customerId;
			return Result.ok({
				id,
				products: customerPayload.data?.products ?? [],
				payment_method: customerPayload.data?.payment_method
			});
		} catch (error) {
			return toExternalError(error, 'Failed to fetch Autumn customer', 'Autumn');
		}
	};

	try {
		const createPayload = await autumn.customers.create({
			id: user.clerkId,
			email: user.email ?? undefined,
			name: user.name ?? undefined
		});

		if (!createPayload.error) {
			const customerId = createPayload.data?.id ?? user.clerkId;
			return await fetchCustomer(customerId);
		}

		const message = createPayload.error?.message ?? 'Failed to create Autumn customer';
		const alreadyExists = message.toLowerCase().includes('already');
		if (!alreadyExists) {
			return Result.err(
				new WebExternalDependencyError({
					message,
					dependency: 'Autumn'
				})
			);
		}

		return await fetchCustomer(user.clerkId);
	} catch (error) {
		return toExternalError(error, 'Failed to create Autumn customer', 'Autumn');
	}
}

async function checkFeature(args: {
	customerId: string;
	featureId: string;
	requiredBalance?: number;
}): Promise<UsageResult<{ usage: number; balance: number; included: number }>> {
	const autumnResult = getAutumnClientResult();
	if (Result.isError(autumnResult)) {
		return Result.err(autumnResult.error);
	}
	const autumn = autumnResult.value;
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

	try {
		const result = await autumn.check(payload);
		if (result.error) {
			return Result.err(
				new WebExternalDependencyError({
					message: result.error.message ?? 'Failed to check Autumn usage',
					dependency: 'Autumn'
				})
			);
		}

		return Result.ok({
			usage: result.data?.usage ?? 0,
			balance: result.data?.balance ?? 0,
			included: result.data?.included_usage ?? 0
		});
	} catch (error) {
		return toExternalError(error, 'Failed to check Autumn usage', 'Autumn');
	}
}

async function trackUsage(args: {
	customerId: string;
	featureId: string;
	value: number;
}): Promise<UsageResult<void>> {
	const autumnResult = getAutumnClientResult();
	if (Result.isError(autumnResult)) {
		return Result.err(autumnResult.error);
	}
	const autumn = autumnResult.value;
	try {
		const result = await autumn.track({
			customer_id: args.customerId,
			feature_id: args.featureId,
			value: args.value
		});
		if (result.error) {
			return Result.err(
				new WebExternalDependencyError({
					message: result.error.message ?? 'Failed to track Autumn usage',
					dependency: 'Autumn'
				})
			);
		}
		return Result.ok(undefined);
	} catch (error) {
		return toExternalError(error, 'Failed to track Autumn usage', 'Autumn');
	}
}

async function createCheckoutSessionUrl(args: {
	autumnClient: Autumn;
	baseUrl: string;
	customerId: string;
}): Promise<UsageResult<string>> {
	try {
		const payload = await args.autumnClient.checkout({
			customer_id: args.customerId,
			product_id: 'btca_pro',
			success_url: `${args.baseUrl}/app/checkout/success`,
			checkout_session_params: {
				cancel_url: `${args.baseUrl}/app/checkout/cancel`
			}
		});

		if (payload.error) {
			return Result.err(
				new WebExternalDependencyError({
					message: payload.error.message ?? 'Failed to create checkout session',
					dependency: 'Autumn'
				})
			);
		}

		if (payload.data?.url) {
			return Result.ok(payload.data.url);
		}

		const attachPayload = await args.autumnClient.attach({
			customer_id: args.customerId,
			product_id: 'btca_pro',
			success_url: `${args.baseUrl}/app/checkout/success`
		});

		if (attachPayload.error) {
			return Result.err(
				new WebExternalDependencyError({
					message: attachPayload.error.message ?? 'Failed to attach checkout session',
					dependency: 'Autumn'
				})
			);
		}

		const checkoutUrl = attachPayload.data?.checkout_url;
		if (!checkoutUrl) {
			return Result.err(
				new WebExternalDependencyError({
					message: 'Checkout session created but no checkout URL was returned',
					dependency: 'Autumn'
				})
			);
		}

		return Result.ok(checkoutUrl);
	} catch (error) {
		return toExternalError(error, 'Failed to create checkout session', 'Autumn');
	}
}

async function createBillingPortalSessionUrl(args: {
	autumnClient: Autumn;
	baseUrl: string;
	customerId: string;
}): Promise<UsageResult<string>> {
	try {
		const payload = await args.autumnClient.customers.billingPortal(args.customerId, {
			return_url: `${args.baseUrl}/app/settings/billing`
		});

		if (payload.error) {
			return Result.err(
				new WebExternalDependencyError({
					message: payload.error.message ?? 'Failed to create billing portal session',
					dependency: 'Autumn'
				})
			);
		}

		const billingUrl = payload.data?.url;
		if (!billingUrl) {
			return Result.err(
				new WebExternalDependencyError({
					message: 'Billing portal session created but no URL was returned',
					dependency: 'Autumn'
				})
			);
		}

		return Result.ok(billingUrl);
	} catch (error) {
		return toExternalError(error, 'Failed to create billing portal session', 'Autumn');
	}
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

const featureMetricsValidator = v.object({
	usage: v.number(),
	balance: v.number(),
	included: v.number()
});

export const ensureUsageAvailable = action({
	args: {
		instanceId: v.id('instances'),
		question: v.string(),
		resources: v.array(v.string())
	},
	returns: v.union(
		v.object({
			ok: v.literal(false),
			reason: v.union(v.literal('subscription_required'), v.literal('free_limit_reached'))
		}),
		v.object({
			ok: v.boolean(),
			reason: v.union(v.string(), v.null()),
			metrics: v.object({
				tokensIn: featureMetricsValidator,
				tokensOut: featureMetricsValidator,
				sandboxHours: featureMetricsValidator
			}),
			inputTokens: v.number(),
			sandboxUsageHours: v.number(),
			customerId: v.string()
		})
	),
	handler: async (ctx, args): Promise<UsageCheckResult> => {
		const instance = await unwrapAuthResult(
			await requireInstanceOwnershipActionResult(ctx, args.instanceId)
		);

		const identity = await ctx.auth.getUserIdentity();
		const autumnCustomer = unwrapUsage(
			await getOrCreateCustomer({
				clerkId: instance.clerkId,
				email: identity?.email,
				name:
					identity?.name ??
					(identity?.givenName
						? `${identity.givenName} ${identity.familyName ?? ''}`.trim()
						: undefined)
			})
		);
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
			const chatMessages = unwrapUsage(
				await checkFeature({
					customerId: autumnCustomer.id ?? instance.clerkId,
					featureId: FEATURE_IDS.chatMessages,
					requiredBalance: 1
				})
			);

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

			const [tokensInResult, tokensOutResult, sandboxHoursResult] = await Promise.all([
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
			const tokensIn = unwrapUsage(tokensInResult);
			const tokensOut = unwrapUsage(tokensOutResult);
			const sandboxHours = unwrapUsage(sandboxHoursResult);

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
	returns: v.object({
		outputTokens: v.number(),
		sandboxUsageHours: v.number(),
		customerId: v.string()
	}),
	handler: async (ctx, args): Promise<FinalizeUsageResult> => {
		const instance = await unwrapAuthResult(
			await requireInstanceOwnershipActionResult(ctx, args.instanceId)
		);

		const identity = await ctx.auth.getUserIdentity();
		const autumnCustomer = unwrapUsage(
			await getOrCreateCustomer({
				clerkId: instance.clerkId,
				email: identity?.email,
				name:
					identity?.name ??
					(identity?.givenName
						? `${identity.givenName} ${identity.familyName ?? ''}`.trim()
						: undefined)
			})
		);

		const activeProduct = getActiveProduct(autumnCustomer.products);
		const isFreePlan = activeProduct?.id === 'free_plan';
		const isProPlan = activeProduct?.id === 'btca_pro';

		const tasks: Promise<UsageResult<void>>[] = [];

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

		const taskResults = await Promise.all(tasks);
		for (const result of taskResults) {
			if (Result.isError(result)) {
				throwUsageError(result.error);
			}
		}

		return {
			outputTokens,
			sandboxUsageHours,
			customerId: autumnCustomer.id ?? instance.clerkId
		};
	}
});

const usageMetricDisplayValidator = v.object({
	usedPct: v.number(),
	remainingPct: v.number(),
	isDepleted: v.boolean()
});

export const getBillingSummary = action({
	args: billingArgs,
	returns: v.object({
		plan: v.union(v.literal('pro'), v.literal('free'), v.literal('none')),
		status: v.union(
			v.literal('active'),
			v.literal('trialing'),
			v.literal('canceled'),
			v.literal('none')
		),
		currentPeriodEnd: v.optional(v.number()),
		canceledAt: v.optional(v.number()),
		customer: v.object({ name: v.null(), email: v.null() }),
		paymentMethod: v.any(),
		usage: v.object({
			tokensIn: usageMetricDisplayValidator,
			tokensOut: usageMetricDisplayValidator,
			sandboxHours: usageMetricDisplayValidator
		}),
		freeMessages: v.optional(
			v.object({
				used: v.number(),
				total: v.number(),
				remaining: v.number()
			})
		)
	}),
	handler: async (ctx, args): Promise<BillingSummaryResult> => {
		const instance = await unwrapAuthResult(
			await requireInstanceOwnershipActionResult(ctx, args.instanceId)
		);

		const identity = await ctx.auth.getUserIdentity();
		const autumnCustomer = unwrapUsage(
			await getOrCreateCustomer({
				clerkId: instance.clerkId,
				email: identity?.email,
				name:
					identity?.name ??
					(identity?.givenName
						? `${identity.givenName} ${identity.familyName ?? ''}`.trim()
						: undefined)
			})
		);
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

		const [tokensInResult, tokensOutResult, sandboxHoursResult, chatMessagesResult] =
			await Promise.all([
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
		const tokensIn = unwrapUsage(tokensInResult);
		const tokensOut = unwrapUsage(tokensOutResult);
		const sandboxHours = unwrapUsage(sandboxHoursResult);
		const chatMessages = unwrapUsage(chatMessagesResult);

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
	returns: v.object({ url: v.string() }),
	handler: async (ctx, args): Promise<SessionResult> => {
		const instance = await unwrapAuthResult(
			await requireInstanceOwnershipActionResult(ctx, args.instanceId)
		);

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.CHECKOUT_STARTED,
			properties: {
				instanceId: args.instanceId,
				plan: 'btca_pro'
			}
		});

		const identity = await ctx.auth.getUserIdentity();
		const autumnCustomer = unwrapUsage(
			await getOrCreateCustomer({
				clerkId: instance.clerkId,
				email: identity?.email,
				name:
					identity?.name ??
					(identity?.givenName
						? `${identity.givenName} ${identity.familyName ?? ''}`.trim()
						: undefined)
			})
		);
		const checkoutUrl = unwrapUsage(
			await createCheckoutSessionUrl({
				autumnClient: unwrapUsage(getAutumnClientResult()),
				baseUrl: args.baseUrl,
				customerId: autumnCustomer.id ?? instance.clerkId
			})
		);

		return { url: checkoutUrl };
	}
});

export const createBillingPortalSession = action({
	args: {
		instanceId: v.id('instances'),
		baseUrl: v.string()
	},
	returns: v.object({ url: v.string() }),
	handler: async (ctx, args): Promise<SessionResult> => {
		const instance = await unwrapAuthResult(
			await requireInstanceOwnershipActionResult(ctx, args.instanceId)
		);

		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: instance.clerkId,
			event: AnalyticsEvents.BILLING_PORTAL_OPENED,
			properties: {
				instanceId: args.instanceId
			}
		});

		const identity = await ctx.auth.getUserIdentity();
		const autumnCustomer = unwrapUsage(
			await getOrCreateCustomer({
				clerkId: instance.clerkId,
				email: identity?.email,
				name:
					identity?.name ??
					(identity?.givenName
						? `${identity.givenName} ${identity.familyName ?? ''}`.trim()
						: undefined)
			})
		);
		const billingPortalUrl = unwrapUsage(
			await createBillingPortalSessionUrl({
				autumnClient: unwrapUsage(getAutumnClientResult()),
				baseUrl: args.baseUrl,
				customerId: autumnCustomer.id ?? instance.clerkId
			})
		);

		return { url: billingPortalUrl };
	}
});
