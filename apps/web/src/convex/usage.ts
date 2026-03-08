import { Autumn } from 'autumn-js';
import { v } from 'convex/values';
import { Result } from 'better-result';

import type { Doc } from './_generated/dataModel.js';
import { internal } from './_generated/api.js';
import { action, internalAction, type ActionCtx } from './_generated/server.js';
import { AnalyticsEvents } from './analyticsEvents.js';
import { instances, scheduled } from './apiHelpers.js';
import { requireInstanceOwnershipActionResult, unwrapAuthResult } from './authHelpers.js';
import { withPrivateApiKey } from './privateWrappers.js';
import {
	PRO_AI_BUDGET_MICROS,
	getPreflightAiBudgetMicros,
	totalAiBudgetMicros
} from '../lib/billing/aiBudget';
import { getWebSandboxModel } from '../lib/models/webSandboxModels';
import {
	WebConfigMissingError,
	WebExternalDependencyError,
	WebUnhandledError,
	WebValidationError,
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
				aiBudget: FeatureMetrics;
			};
			inputTokens: number;
			requiredBudgetMicros: number;
			modelId: string;
			customerId: string;
	  };

type FinalizeUsageResult = {
	chargedBudgetMicros: number;
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
	customer: {
		name: string | null;
		email: string | null;
	};
	paymentMethod: unknown;
	usage: {
		aiBudget: UsageMetricDisplay;
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

const CHARS_PER_TOKEN = 4;
const FEATURE_IDS = {
	aiBudget: 'ai_budget',
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

function clampPercent(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

type AutumnCustomer = {
	id: string;
	name?: string | null;
	email?: string | null;
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

const toUsageMetric = (args: { usage: number; included: number; balance: number }) => {
	const usedPct = args.included > 0 ? clampPercent((args.usage / args.included) * 100) : 0;
	const remainingPct = clampPercent(100 - usedPct);
	return {
		usedPct,
		remainingPct,
		isDepleted: remainingPct <= 0 || args.balance <= 0
	};
};

const customerExpand = ['payment_method'] as const;
const checkoutSuccessPath = '/app/checkout/success';
const checkoutCancelPath = '/app/checkout/cancel';
const billingReturnPath = '/app/settings/billing';

const isAutumnNotFound = (args: { message?: string; statusCode?: number }) =>
	args.statusCode === 404 || args.message?.toLowerCase().includes('not found') === true;

const toAutumnCustomer = (
	customer: {
		id: string | null;
		name: string | null;
		email: string | null;
		products: {
			id?: string;
			status?: string;
			current_period_end?: number | null;
			canceled_at?: number | null;
		}[];
		payment_method?: unknown;
	},
	fallbackId: string
): AutumnCustomer => ({
	id: customer.id ?? fallbackId,
	name: customer.name,
	email: customer.email,
	products: customer.products ?? [],
	payment_method: customer.payment_method
});

async function resolveProUsageMetrics(args: {
	customerId: string;
	requiredBalance?: number;
}): Promise<UsageResult<FeatureMetrics>> {
	return await checkFeature({
		customerId: args.customerId,
		featureId: FEATURE_IDS.aiBudget,
		requiredBalance: args.requiredBalance
	});
}

async function getResolvedModelId(args: {
	ctx: ActionCtx;
	instanceId: Doc<'instances'>['_id'];
	projectId?: Doc<'projects'>['_id'];
}) {
	if (!args.projectId) {
		return getWebSandboxModel().id;
	}

	const project = await args.ctx.runQuery(internal.projects.getInternal, {
		projectId: args.projectId
	});

	if (!project || project.instanceId !== args.instanceId) {
		throw new WebValidationError({ message: 'Project not found', field: 'projectId' });
	}

	return getWebSandboxModel(project.model).id;
}

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

	const fetchCustomer = async (): Promise<UsageResult<AutumnCustomer | null>> => {
		try {
			const customerPayload = await autumn.customers.get(user.clerkId, {
				expand: customerExpand
			});
			if (customerPayload.error) {
				if (
					isAutumnNotFound({
						message: customerPayload.error.message,
						statusCode: customerPayload.statusCode
					})
				) {
					return Result.ok(null);
				}

				return Result.err(
					new WebExternalDependencyError({
						message: customerPayload.error.message ?? 'Failed to fetch Autumn customer',
						dependency: 'Autumn'
					})
				);
			}

			return Result.ok(toAutumnCustomer(customerPayload.data, user.clerkId));
		} catch (error) {
			return toExternalError(error, 'Failed to fetch Autumn customer', 'Autumn');
		}
	};

	try {
		const existingCustomerResult = await fetchCustomer();
		if (Result.isError(existingCustomerResult)) {
			return Result.err(existingCustomerResult.error);
		}
		if (existingCustomerResult.value) {
			return Result.ok(existingCustomerResult.value);
		}

		const createPayload = await autumn.customers.create({
			id: user.clerkId,
			email: user.email ?? undefined,
			name: user.name ?? undefined,
			expand: customerExpand
		});

		if (!createPayload.error) {
			return Result.ok(toAutumnCustomer(createPayload.data, user.clerkId));
		}

		const concurrentFetchResult = await fetchCustomer();
		if (!Result.isError(concurrentFetchResult) && concurrentFetchResult.value) {
			return Result.ok(concurrentFetchResult.value);
		}

		return Result.err(
			new WebExternalDependencyError({
				message: createPayload.error?.message ?? 'Failed to create Autumn customer',
				dependency: 'Autumn'
			})
		);
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

async function resetAiBudgetBalance(args: {
	customerId: string;
	remaining: number;
}): Promise<UsageResult<void>> {
	const autumnResult = getAutumnClientResult();
	if (Result.isError(autumnResult)) {
		return Result.err(autumnResult.error);
	}
	const autumn = autumnResult.value;
	try {
		const result = await autumn.v2.balances.update({
			customer_id: args.customerId,
			feature_id: FEATURE_IDS.aiBudget,
			remaining: args.remaining
		});
		if (result.error) {
			return Result.err(
				new WebExternalDependencyError({
					message: result.error.message ?? 'Failed to reset Autumn AI budget balance',
					dependency: 'Autumn'
				})
			);
		}
		return Result.ok(undefined);
	} catch (error) {
		return toExternalError(error, 'Failed to reset Autumn AI budget balance', 'Autumn');
	}
}

async function createCheckoutSessionUrl(args: {
	autumnClient: Autumn;
	baseUrl: string;
	customerId: string;
	customerData?: {
		email?: string | null;
		name?: string | null;
	};
}): Promise<UsageResult<string>> {
	try {
		const payload = await args.autumnClient.attach({
			customer_id: args.customerId,
			product_id: 'btca_pro',
			force_checkout: true,
			success_url: `${args.baseUrl}${checkoutSuccessPath}`,
			customer_data:
				args.customerData?.email || args.customerData?.name
					? {
							email: args.customerData.email ?? undefined,
							name: args.customerData.name ?? undefined
						}
					: undefined,
			checkout_session_params: {
				cancel_url: `${args.baseUrl}${checkoutCancelPath}`
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

		return Result.ok(payload.data?.checkout_url ?? `${args.baseUrl}${checkoutSuccessPath}`);
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
			return_url: `${args.baseUrl}${billingReturnPath}`
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

	await ctx.runMutation(
		instances.mutations.setSubscriptionState,
		withPrivateApiKey({
			instanceId: instance._id,
			plan: snapshot.plan,
			status: snapshot.status,
			productId: snapshot.productId,
			currentPeriodEnd: snapshot.currentPeriodEnd ?? undefined,
			canceledAt: snapshot.canceledAt ?? undefined
		})
	);

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
		resources: v.array(v.string()),
		projectId: v.optional(v.id('projects'))
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
				aiBudget: featureMetricsValidator
			}),
			inputTokens: v.number(),
			requiredBudgetMicros: v.number(),
			modelId: v.string(),
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
		const modelId = await getResolvedModelId({
			ctx,
			instanceId: instance._id,
			projectId: args.projectId
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
					aiBudget: { usage: 0, balance: 0, included: PRO_AI_BUDGET_MICROS }
				},
				inputTokens: 0,
				requiredBudgetMicros: 0,
				modelId,
				customerId: autumnCustomer.id ?? instance.clerkId
			};
		}

		if (isProPlan) {
			const inputTokens = estimateTokensFromText(args.question);
			const requiredBudgetMicros = getPreflightAiBudgetMicros({
				modelId,
				inputTokens
			});
			const aiBudget = unwrapUsage(
				await resolveProUsageMetrics({
					customerId: autumnCustomer.id ?? instance.clerkId,
					requiredBalance: requiredBudgetMicros
				})
			);
			const ok = aiBudget.balance >= requiredBudgetMicros;

			if (!ok) {
				await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
					distinctId: instance.clerkId,
					event: AnalyticsEvents.USAGE_LIMIT_REACHED,
					properties: {
						instanceId: args.instanceId,
						limitTypes: ['aiBudget'],
						modelId,
						requiredBudgetMicros,
						aiBudgetBalance: aiBudget.balance
					}
				});
			}

			return {
				ok,
				reason: ok ? null : 'limit_reached',
				metrics: {
					aiBudget
				},
				inputTokens,
				requiredBudgetMicros,
				modelId,
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
		modelId: v.string(),
		inputTokens: v.number(),
		outputTokens: v.number(),
		reasoningTokens: v.optional(v.number()),
		cacheReadTokens: v.optional(v.number()),
		cacheWriteTokens: v.optional(v.number()),
		chargedBudgetMicros: v.optional(v.number())
	},
	returns: v.object({
		chargedBudgetMicros: v.number(),
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

		const chargedBudgetMicros = isProPlan
			? Math.max(
					0,
					args.chargedBudgetMicros ??
						totalAiBudgetMicros({
							modelId: args.modelId,
							inputTokens: args.inputTokens,
							outputTokens: args.outputTokens,
							reasoningTokens: args.reasoningTokens,
							cacheReadTokens: args.cacheReadTokens,
							cacheWriteTokens: args.cacheWriteTokens
						})
				)
			: 0;

		if (isProPlan && chargedBudgetMicros > 0) {
			const trackAiBudgetResult = await trackUsage({
				customerId: autumnCustomer.id ?? instance.clerkId,
				featureId: FEATURE_IDS.aiBudget,
				value: chargedBudgetMicros
			});

			if (Result.isError(trackAiBudgetResult)) {
				throwUsageError(trackAiBudgetResult.error);
			}
		}

		const taskResults = await Promise.all(tasks);
		for (const result of taskResults) {
			if (Result.isError(result)) {
				throwUsageError(result.error);
			}
		}

		return {
			chargedBudgetMicros,
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
		customer: v.object({
			name: v.union(v.string(), v.null()),
			email: v.union(v.string(), v.null())
		}),
		paymentMethod: v.any(),
		usage: v.object({
			aiBudget: usageMetricDisplayValidator
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

		const [proUsageResult, chatMessagesResult] = await Promise.all([
			resolveProUsageMetrics({
				customerId: autumnCustomer.id ?? instance.clerkId
			}),
			checkFeature({
				customerId: autumnCustomer.id ?? instance.clerkId,
				featureId: FEATURE_IDS.chatMessages
			})
		]);
		const aiBudget = unwrapUsage(proUsageResult);
		const chatMessages = unwrapUsage(chatMessagesResult);
		const aiBudgetUsage = toUsageMetric(aiBudget);

		const result: BillingSummaryResult = {
			plan,
			status,
			currentPeriodEnd: activeProduct?.current_period_end ?? undefined,
			canceledAt: activeProduct?.canceled_at ?? undefined,
			customer: {
				name: autumnCustomer.name ?? null,
				email: autumnCustomer.email ?? null
			},
			paymentMethod: autumnCustomer.payment_method ?? null,
			usage: {
				aiBudget: aiBudgetUsage
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

export const resetProAiBudgetBalances = internalAction({
	args: {},
	returns: v.object({
		checked: v.number(),
		reset: v.number(),
		skipped: v.number(),
		failed: v.number()
	}),
	handler: async (ctx) => {
		const allInstances = await ctx.runQuery(scheduled.queries.listInstances, {});
		let reset = 0;
		let skipped = 0;
		let failed = 0;

		for (const instance of allInstances) {
			try {
				const autumnCustomer = unwrapUsage(
					await getOrCreateCustomer({
						clerkId: instance.clerkId
					})
				);
				const activeProduct = getActiveProduct(autumnCustomer.products);
				if (activeProduct?.id !== 'btca_pro') {
					skipped++;
					continue;
				}

				unwrapUsage(
					await resetAiBudgetBalance({
						customerId: autumnCustomer.id ?? instance.clerkId,
						remaining: PRO_AI_BUDGET_MICROS
					})
				);
				reset++;
			} catch (error) {
				failed++;
				console.error('Failed to reset AI budget balance', {
					instanceId: instance._id,
					clerkId: instance.clerkId,
					error
				});
			}
		}

		return {
			checked: allInstances.length,
			reset,
			skipped,
			failed
		};
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
				customerId: autumnCustomer.id ?? instance.clerkId,
				customerData: {
					email: autumnCustomer.email,
					name: autumnCustomer.name
				}
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
