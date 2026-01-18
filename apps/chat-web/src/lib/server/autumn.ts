import { Autumn, type CustomerProduct } from 'autumn-js';
import { env } from '$env/dynamic/private';
import { BILLING_PLAN, FEATURE_IDS } from '$lib/billing/plans';
import type { BillingSummary, UsageMetric } from '$lib/billing/types';
import { clampPercent } from './usage.ts';

type ConvexUser = {
	clerkId: string;
	email?: string | null;
	name?: string | null;
};

type AutumnCustomer = {
	id?: string | null;
	email?: string | null;
	name?: string | null;
	products?: CustomerProduct[];
	payment_method?: BillingSummary['paymentMethod'];
};

const createAutumnService = () => {
	if (!env.AUTUMN_SECRET_KEY) {
		throw new Error('AUTUMN_SECRET_KEY is required');
	}

	const autumn = new Autumn({
		secretKey: env.AUTUMN_SECRET_KEY
	});

	const requireCustomerId = (id: string | null | undefined) => {
		if (!id) throw new Error('Autumn customer ID missing');
		return id;
	};

	const getOrCreateCustomer = async (user: ConvexUser): Promise<AutumnCustomer> => {
		const createResult = await autumn.customers.create({
			id: user.clerkId,
			email: user.email ?? undefined,
			name: user.name ?? undefined
		});

		if (!createResult.error) {
			return {
				...createResult.data,
				id: requireCustomerId(createResult.data.id)
			};
		}

		const createErrorMessage = createResult.error.message ?? 'Failed to create customer';
		const createErrorCode = (createResult.error as { code?: string }).code;
		const isAlreadyExists =
			createErrorCode === 'already_exists' ||
			createErrorCode === 'customer_already_exists' ||
			createErrorMessage.toLowerCase().includes('already');

		if (!isAlreadyExists) {
			throw new Error(createErrorMessage);
		}

		const getResult = await autumn.customers.get(user.clerkId, {
			expand: ['payment_method']
		});

		if (getResult.error) {
			throw new Error(getResult.error.message);
		}

		if (!getResult.data) {
			throw new Error('Autumn customer missing');
		}

		return {
			...getResult.data,
			id: requireCustomerId(getResult.data.id)
		};
	};

	const getActiveProduct = (products: CustomerProduct[] | undefined) => {
		if (!products?.length) return null;
		return (
			products.find(
				(product) =>
					product.id === BILLING_PLAN.id &&
					(product.status === 'active' || product.status === 'trialing')
			) ?? null
		);
	};

	const toUsageMetric = (args: {
		usage: number;
		included: number;
		balance: number;
	}): UsageMetric => {
		const usedPct = args.included > 0 ? clampPercent((args.usage / args.included) * 100) : 0;
		const remainingPct = clampPercent(100 - usedPct);
		return {
			usedPct,
			remainingPct,
			isDepleted: remainingPct <= 0 || args.balance <= 0
		};
	};

	const checkFeature = async (customerId: string, featureId: string, requiredBalance?: number) => {
		const payload: {
			customer_id: string;
			feature_id: string;
			required_balance?: number;
		} = {
			customer_id: customerId,
			feature_id: featureId
		};
		if (requiredBalance !== undefined) {
			payload.required_balance = requiredBalance;
		}

		const result = await autumn.check(payload);

		if (result.error) {
			throw new Error(result.error.message);
		}

		return {
			usage: result.data.usage ?? 0,
			balance: result.data.balance ?? 0,
			included: result.data.included_usage ?? 0
		};
	};

	return {
		getOrCreateCustomer,
		getBillingSummary: async (user: ConvexUser): Promise<BillingSummary> => {
			const customer = await getOrCreateCustomer(user);
			const activeProduct = getActiveProduct(customer.products);
			const plan = activeProduct ? 'pro' : 'none';
			const status = activeProduct
				? (activeProduct.status as 'active' | 'trialing' | 'canceled')
				: 'none';

			const [tokensIn, tokensOut, sandboxHours] = await Promise.all([
				checkFeature(customer.id ?? user.clerkId, FEATURE_IDS.tokensIn),
				checkFeature(customer.id ?? user.clerkId, FEATURE_IDS.tokensOut),
				checkFeature(customer.id ?? user.clerkId, FEATURE_IDS.sandboxHours)
			]);

			return {
				plan,
				status,
				currentPeriodEnd: activeProduct?.current_period_end ?? undefined,
				customer: {
					name: customer.name ?? null,
					email: customer.email ?? null
				},
				paymentMethod: customer.payment_method ?? null,
				usage: {
					tokensIn: toUsageMetric(tokensIn),
					tokensOut: toUsageMetric(tokensOut),
					sandboxHours: toUsageMetric(sandboxHours)
				}
			};
		},
		ensureUsageAvailable: async (args: {
			customerId: string;
			requiredTokensIn?: number;
			requiredTokensOut?: number;
			requiredSandboxHours?: number;
		}) => {
			const [tokensIn, tokensOut, sandboxHours] = await Promise.all([
				checkFeature(args.customerId, FEATURE_IDS.tokensIn, args.requiredTokensIn),
				checkFeature(args.customerId, FEATURE_IDS.tokensOut, args.requiredTokensOut),
				checkFeature(args.customerId, FEATURE_IDS.sandboxHours, args.requiredSandboxHours)
			]);

			const hasEnough = (balance: number, required?: number) =>
				required == null ? balance > 0 : balance >= required;

			return {
				ok:
					hasEnough(tokensIn.balance, args.requiredTokensIn) &&
					hasEnough(tokensOut.balance, args.requiredTokensOut) &&
					hasEnough(sandboxHours.balance, args.requiredSandboxHours),
				metrics: {
					tokensIn,
					tokensOut,
					sandboxHours
				}
			};
		},
		trackUsage: async (args: {
			customerId: string;
			tokensIn?: number;
			tokensOut?: number;
			sandboxHours?: number;
		}) => {
			const tasks: Promise<unknown>[] = [];
			if (args.tokensIn && args.tokensIn > 0) {
				tasks.push(
					autumn.track({
						customer_id: args.customerId,
						feature_id: FEATURE_IDS.tokensIn,
						value: args.tokensIn
					})
				);
			}
			if (args.tokensOut && args.tokensOut > 0) {
				tasks.push(
					autumn.track({
						customer_id: args.customerId,
						feature_id: FEATURE_IDS.tokensOut,
						value: args.tokensOut
					})
				);
			}
			if (args.sandboxHours && args.sandboxHours > 0) {
				tasks.push(
					autumn.track({
						customer_id: args.customerId,
						feature_id: FEATURE_IDS.sandboxHours,
						value: args.sandboxHours
					})
				);
			}

			const results = await Promise.all(tasks);
			for (const result of results) {
				const maybeError = result as { error?: { message: string } };
				if (maybeError.error) {
					throw new Error(maybeError.error.message);
				}
			}
		},
		createCheckoutSession: async (args: { user: ConvexUser; baseUrl: string }) => {
			const customer = await getOrCreateCustomer(args.user);
			const checkoutResult = await autumn.checkout({
				customer_id: requireCustomerId(customer.id),
				product_id: BILLING_PLAN.id,
				success_url: `${args.baseUrl}/checkout/success`,
				checkout_session_params: {
					cancel_url: `${args.baseUrl}/checkout/cancel`
				}
			});

			if (checkoutResult.error) {
				throw new Error(checkoutResult.error.message);
			}

			if (!checkoutResult.data.url) {
				const attachResult = await autumn.attach({
					customer_id: requireCustomerId(customer.id),
					product_id: BILLING_PLAN.id,
					success_url: `${args.baseUrl}/checkout/success`
				});

				if (attachResult.error) {
					throw new Error(attachResult.error.message);
				}

				return { url: attachResult.data.checkout_url ?? `${args.baseUrl}/checkout/success` };
			}

			return { url: checkoutResult.data.url };
		},
		createBillingPortalSession: async (args: { user: ConvexUser; baseUrl: string }) => {
			const customer = await getOrCreateCustomer(args.user);
			const portalResult = await autumn.customers.billingPortal(requireCustomerId(customer.id), {
				return_url: `${args.baseUrl}/settings/billing`
			});

			if (portalResult.error) {
				throw new Error(portalResult.error.message);
			}

			return { url: portalResult.data.url };
		},
		getActiveProduct
	};
};

export type AutumnService = ReturnType<typeof createAutumnService>;

let autumnService: AutumnService | undefined;

export const AutumnService = {
	get: () => (autumnService ??= createAutumnService())
};
