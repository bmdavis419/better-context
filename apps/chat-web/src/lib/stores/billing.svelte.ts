import { createContext } from 'svelte';
import { useConvexClient } from 'convex-svelte';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { BillingSummary } from '$lib/billing/types';

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
	const store = internalGetStore();
	if (!store) throw new Error('Billing store not found. Did you call setBillingStore?');
	return store;
};

export const setBillingStore = () => internalSetStore(new BillingStore());
