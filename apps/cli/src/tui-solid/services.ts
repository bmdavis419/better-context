import { BunContext } from '@effect/platform-bun';
import { Effect, Layer, ManagedRuntime, Stream } from 'effect';
import { ConfigService } from '../services/config.ts';
import { OcService, type OcEvent } from '../services/oc.ts';
import type { Repo } from './types.ts';

const ServicesLayer = Layer.mergeAll(OcService.Default, ConfigService.Default).pipe(
	Layer.provideMerge(BunContext.layer)
);

const runtime = ManagedRuntime.make(ServicesLayer);

export const services = {
	getRepos: (): Promise<Repo[]> =>
		runtime.runPromise(
			Effect.gen(function* () {
				const config = yield* ConfigService;
				const repos = yield* config.getRepos();
				// Convert readonly to mutable
				return repos.map((r) => ({ ...r }));
			})
		),

	addRepo: (repo: Repo): Promise<Repo> =>
		runtime.runPromise(
			Effect.gen(function* () {
				const config = yield* ConfigService;
				const added = yield* config.addRepo(repo);
				return { ...added };
			})
		),

	removeRepo: (name: string): Promise<void> =>
		runtime.runPromise(
			Effect.gen(function* () {
				const config = yield* ConfigService;
				yield* config.removeRepo(name);
			})
		),

	getModel: (): Promise<{ provider: string; model: string }> =>
		runtime.runPromise(
			Effect.gen(function* () {
				const config = yield* ConfigService;
				return yield* config.getModel();
			})
		),

	updateModel: (provider: string, model: string): Promise<{ provider: string; model: string }> =>
		runtime.runPromise(
			Effect.gen(function* () {
				const config = yield* ConfigService;
				return yield* config.updateModel({ provider, model });
			})
		),

	// OC operations
	spawnTui: (tech: string): Promise<void> =>
		runtime.runPromise(
			Effect.gen(function* () {
				const oc = yield* OcService;
				yield* oc.spawnTui({ tech });
			})
		),

	askQuestion: (tech: string, question: string, onEvent: (event: OcEvent) => void): Promise<void> =>
		runtime.runPromise(
			Effect.gen(function* () {
				const oc = yield* OcService;
				const stream = yield* oc.askQuestion({
					question,
					tech,
					suppressLogs: true
				});

				yield* Stream.runForEach(stream, (event) => Effect.sync(() => onEvent(event)));
			})
		)
};

export type Services = typeof services;
