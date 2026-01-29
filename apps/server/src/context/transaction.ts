import { Result } from 'better-result';

import { Metrics } from '../metrics/index.ts';
import { Context } from './index.ts';

export namespace Transaction {
	export const run = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
		const store = Context.require();
		const depth = store.txDepth;
		store.txDepth = depth + 1;

		const start = performance.now();
		Metrics.info('tx.start', { name, depth });
		const result = await Result.tryPromise(fn);
		store.txDepth = depth;

		return result.match({
			ok: (value) => {
				Metrics.info('tx.commit', { name, depth, ms: Math.round(performance.now() - start) });
				return value;
			},
			err: (cause) => {
				Metrics.error('tx.rollback', {
					name,
					depth,
					ms: Math.round(performance.now() - start),
					error: Metrics.errorInfo(cause)
				});
				throw cause;
			}
		});
	};
}
