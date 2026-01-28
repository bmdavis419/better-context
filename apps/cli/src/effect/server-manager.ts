import { Effect } from 'effect';

import { ensureServer, type EnsureServerOptions } from '../server/manager.ts';

export const ensureServerEffect = (options: EnsureServerOptions = {}) =>
	Effect.tryPromise(() => ensureServer(options));

export const withServer = (options: EnsureServerOptions = {}) =>
	Effect.acquireRelease(
		ensureServerEffect(options),
		(server) => Effect.sync(() => server.stop())
	);
