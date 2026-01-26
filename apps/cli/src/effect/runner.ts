import { Effect } from 'effect';

import { CliExit } from './cli-exit.ts';

export const runCli = async <A>(
	effect: Effect.Effect<A, unknown, never>,
	options?: {
		onError?: (error: unknown) => void;
		onSuccess?: (result: A) => void;
	}
): Promise<void> => {
	try {
		const result = await Effect.runPromise(effect);
		options?.onSuccess?.(result);
	} catch (error) {
		if (error instanceof CliExit) {
			if (!error.printed && error.message && options?.onError) {
				options.onError(error);
			}
			process.exit(error.code);
		}

		options?.onError?.(error);
		process.exit(1);
	}
};
