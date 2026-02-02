import { createContext } from 'svelte';
import { useQuery, useConvexClient } from 'convex-svelte';
import { instances } from '../../convex/apiHelpers';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { trackEvent, ClientAnalyticsEvents } from './analytics.svelte';

type InstanceStatus = {
	instance: Doc<'instances'>;
	cachedResources: Doc<'cachedResources'>[];
} | null;

type InstanceActionResponse = {
	success?: boolean;
	serverUrl?: string;
	stopped?: boolean;
	updated?: boolean;
	error?: string;
};

type EnsureInstanceResult = {
	instanceId: Id<'instances'>;
	status: 'created' | 'exists' | 'provisioning';
};

class InstanceStore {
	private _query = useQuery(instances.queries.getStatus, {});
	private _client = useConvexClient();
	private _error = $state<string | null>(null);
	private _isBootstrapping = $state(false);
	private _hasBootstrapped = $state(false);

	get status(): InstanceStatus {
		return this._query.data ?? null;
	}

	get instance() {
		return this.status?.instance ?? null;
	}

	get cachedResources() {
		return this.status?.cachedResources ?? [];
	}

	get state() {
		return this.status?.instance.state ?? null;
	}

	get btcaVersion() {
		return this.status?.instance.btcaVersion ?? null;
	}

	get opencodeVersion() {
		return this.status?.instance.opencodeVersion ?? null;
	}

	get latestBtcaVersion() {
		return this.status?.instance.latestBtcaVersion ?? null;
	}

	get latestOpencodeVersion() {
		return this.status?.instance.latestOpencodeVersion ?? null;
	}

	get btcaUpdateAvailable() {
		const current = this.btcaVersion;
		const latest = this.latestBtcaVersion;
		return Boolean(current && latest && current !== latest);
	}

	get opencodeUpdateAvailable() {
		const current = this.opencodeVersion;
		const latest = this.latestOpencodeVersion;
		return Boolean(current && latest && current !== latest);
	}

	get updateAvailable() {
		return this.btcaUpdateAvailable;
	}

	get storageUsedBytes() {
		return this.status?.instance.storageUsedBytes ?? null;
	}

	get error() {
		return this._error ?? this._query.error?.message ?? null;
	}

	get isLoading() {
		return this._query.isLoading;
	}

	get isBootstrapping() {
		return this._isBootstrapping;
	}

	get hasBootstrapped() {
		return this._hasBootstrapped;
	}

	get needsBootstrap() {
		return !this._query.isLoading && !this.instance && !this._hasBootstrapped;
	}

	async ensureExists(): Promise<EnsureInstanceResult | null> {
		if (this._isBootstrapping || this._hasBootstrapped) {
			return null;
		}

		this._isBootstrapping = true;
		this._error = null;

		try {
			const result = await this._client.action(instances.actions.ensureInstanceExists, {});
			this._hasBootstrapped = true;
			return result as EnsureInstanceResult;
		} catch (error) {
			this._error = error instanceof Error ? error.message : 'Failed to create instance';
			return null;
		} finally {
			this._isBootstrapping = false;
		}
	}

	async wake(): Promise<InstanceActionResponse> {
		this._error = null;
		trackEvent(ClientAnalyticsEvents.INSTANCE_WAKE_REQUESTED, {
			instanceId: this.instance?._id
		});
		try {
			const result = await this._client.action(instances.actions.wakeMyInstance, {});
			return result as InstanceActionResponse;
		} catch (error) {
			this._error = error instanceof Error ? error.message : 'Instance wake failed';
			return { error: this._error };
		}
	}

	async stop(): Promise<InstanceActionResponse> {
		this._error = null;
		trackEvent(ClientAnalyticsEvents.INSTANCE_STOP_REQUESTED, {
			instanceId: this.instance?._id
		});
		try {
			const result = await this._client.action(instances.actions.stopMyInstance, {});
			return result as InstanceActionResponse;
		} catch (error) {
			this._error = error instanceof Error ? error.message : 'Instance stop failed';
			return { error: this._error };
		}
	}

	async update(): Promise<InstanceActionResponse> {
		this._error = null;
		trackEvent(ClientAnalyticsEvents.INSTANCE_UPDATE_REQUESTED, {
			instanceId: this.instance?._id
		});
		try {
			const result = await this._client.action(instances.actions.updateMyInstance, {});
			return result as InstanceActionResponse;
		} catch (error) {
			this._error = error instanceof Error ? error.message : 'Instance update failed';
			return { error: this._error };
		}
	}

	async reset(): Promise<InstanceActionResponse> {
		this._error = null;
		trackEvent(ClientAnalyticsEvents.INSTANCE_RESET_REQUESTED, {
			instanceId: this.instance?._id
		});
		try {
			const result = await this._client.action(instances.actions.resetMyInstance, {});
			return result as InstanceActionResponse;
		} catch (error) {
			this._error =
				error instanceof Error ? error.message : 'Instance reset failed. Please contact support.';
			return { error: this._error };
		}
	}
}

const [internalGetStore, internalSetStore] = createContext<InstanceStore>();

export const getInstanceStore = () => {
	const store = internalGetStore();
	if (!store) throw new Error('Instance store not found. Did you call setInstanceStore?');
	return store;
};

export const setInstanceStore = () => {
	const store = new InstanceStore();
	internalSetStore(store);
	return store;
};
