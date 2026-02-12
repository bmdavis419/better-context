import { Result } from 'better-result';
import { createContext } from 'svelte';
import { useConvexClient } from 'convex-svelte';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { BillingSummary } from '$lib/billing/types';
import { WebValidationError } from '../result/errors';

class BillingStore {
	private _client = useConvexClient();
	private _summary = $state<BillingSummary | null>(null);
	private _isLoading = $state(false);
	private _error = $state<string | null>(null);
	private instanceId = $state<Id<'instances'> | null>(null);

	get summary() {
		return this._summary;
	}

	get isLoading() {
		return this._isLoading;
	}

	get error() {
		return this._error;
	}

	get isSubscribed() {
		return (
			this._summary?.plan === 'pro' &&
			(this._summary.status === 'active' || this._summary.status === 'trialing')
		);
	}

	get isCanceling() {
		return this.isSubscribed && !!this._summary?.canceledAt;
	}

	get canceledAt() {
		return this._summary?.canceledAt ?? null;
	}

	get isOnFreePlan() {
		return this._summary?.plan === 'free';
	}

	get freeMessagesRemaining() {
		return this._summary?.freeMessages?.remaining ?? 0;
	}

	get freeMessagesTotal() {
		return this._summary?.freeMessages?.total ?? 5;
	}

	get freeMessagesUsed() {
		return this._summary?.freeMessages?.used ?? 0;
	}

	get canChat() {
		if (this._summary?.plan === 'pro') {
			return this._summary.status === 'active' || this._summary.status === 'trialing';
		}
		if (this._summary?.plan === 'free') {
			return (this._summary.freeMessages?.remaining ?? 0) > 0;
		}
		return false;
	}

	get isOverLimit() {
		if (!this._summary) return false;
		if (this._summary.plan === 'free') {
			return (this._summary.freeMessages?.remaining ?? 0) <= 0;
		}
		return (
			this._summary.usage.tokensIn.isDepleted ||
			this._summary.usage.tokensOut.isDepleted ||
			this._summary.usage.sandboxHours.isDepleted
		);
	}

	get hasSummary() {
		return !!this._summary;
	}

	setUserId(instanceId: Id<'instances'> | null) {
		this.instanceId = instanceId;
		if (!instanceId) {
			this._summary = null;
			this._error = null;
			this._isLoading = false;
			return;
		}
		void this.fetch();
	}

	async fetch() {
		if (!this.instanceId) return;
		this._isLoading = true;
		this._error = null;
		try {
			this._summary = (await this._client.action(api.usage.getBillingSummary, {
				instanceId: this.instanceId
			})) as BillingSummary;
		} catch (err) {
			this._error = err instanceof Error ? err.message : 'Failed to load billing';
		} finally {
			this._isLoading = false;
		}
	}

	refetch = async () => {
		await this.fetch();
	};
}

const [internalGetStore, internalSetStore] = createContext<BillingStore>();

export const getBillingStore = () => {
	const missingBillingStoreError = () =>
		new WebValidationError({ message: 'Billing store not found. Did you call setBillingStore?' });

	const getBillingStoreResult = (): Result<BillingStore, WebValidationError> => {
		const store = internalGetStore();
		if (!store) return Result.err(missingBillingStoreError());
		return Result.ok(store);
	};

	return Result.match(getBillingStoreResult(), {
		ok: (store) => store,
		err: (error) => {
			throw error;
		}
	});
};

export const setBillingStore = () => internalSetStore(new BillingStore());
