import { AsyncLocalStorage } from 'node:async_hooks';

export type ContextStore = {
	requestId: string;
	txDepth: number;
};

const storage = new AsyncLocalStorage<ContextStore>();

export namespace Context {
	export const run = <T>(store: ContextStore, fn: () => Promise<T> | T): Promise<T> => {
		return Promise.resolve(storage.run(store, fn));
	};

	export const get = (): ContextStore | undefined => storage.getStore();

	export const require = (): ContextStore => {
		const store = storage.getStore();
		if (!store) throw new Error('Missing AsyncLocalStorage context');
		return store;
	};

	export const requestId = (): string => storage.getStore()?.requestId ?? 'unknown';
}
