import { Result } from 'better-result';

import { Context } from '../context/index.ts';
import { getErrorMessage, getErrorTag } from '../errors.ts';

type LogLevel = 'info' | 'error';

let quietMode = false;

export namespace Metrics {
	export type Fields = Record<string, unknown>;

	export const setQuiet = (quiet: boolean) => {
		quietMode = quiet;
	};

	export const isQuiet = () => quietMode;

	export const errorInfo = (cause: unknown) => ({
		tag: getErrorTag(cause),
		message: getErrorMessage(cause)
	});

	const emit = (level: LogLevel, event: string, fields?: Fields) => {
		if (quietMode) return;

		const payload = {
			ts: new Date().toISOString(),
			level,
			event,
			requestId: Context.requestId(),
			...fields
		};
		const line = JSON.stringify(payload);
		if (level === 'error') console.error(line);
		else console.log(line);
	};

	export const info = (event: string, fields?: Fields) => emit('info', event, fields);
	export const error = (event: string, fields?: Fields) => emit('error', event, fields);

	export const span = async <T>(
		name: string,
		fn: () => Promise<T>,
		fields?: Fields
	): Promise<T> => {
		const start = performance.now();
		const result = await Result.tryPromise(fn);
		return result.match({
			ok: (value) => {
				info('span.ok', { name, ms: Math.round(performance.now() - start), ...fields });
				return value;
			},
			err: (cause) => {
				error('span.err', {
					name,
					ms: Math.round(performance.now() - start),
					...fields,
					error: errorInfo(cause)
				});
				throw cause;
			}
		});
	};
}
