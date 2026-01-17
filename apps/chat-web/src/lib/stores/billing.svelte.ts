import { createContext } from 'svelte';
import { isHttpError } from '@sveltejs/kit';
import { remoteGetBillingSummary } from '$lib/remote/billing.remote';
import type { BillingSummary } from '$lib/billing/types';

class BillingStore {
	private _summary = $state<BillingSummary | null>(null);
	private _isLoading = $state(false);
	private _error = $state<string | null>(null);
	private userId = $state<string | null>(null);

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

	get isOverLimit() {
		if (!this._summary) return false;
		return (
			this._summary.usage.tokensIn.isDepleted ||
			this._summary.usage.tokensOut.isDepleted ||
			this._summary.usage.sandboxHours.isDepleted
		);
	}

	get hasSummary() {
		return !!this._summary;
	}

	setUserId(userId: string | null) {
		this.userId = userId;
		if (!userId) {
			this._summary = null;
			this._error = null;
			this._isLoading = false;
			return;
		}
		void this.fetch();
	}

	async fetch() {
		if (!this.userId) return;
		this._isLoading = true;
		this._error = null;
		try {
			this._summary = await remoteGetBillingSummary({ userId: this.userId });
		} catch (err) {
			if (isHttpError(err)) {
				this._error = err.body?.message ?? 'Failed to load billing';
			} else if (err instanceof Error) {
				this._error = err.message;
			} else {
				this._error = 'Failed to load billing';
			}
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
	const store = internalGetStore();
	if (!store) throw new Error('Billing store not found. Did you call setBillingStore?');
	return store;
};

export const setBillingStore = () => internalSetStore(new BillingStore());
