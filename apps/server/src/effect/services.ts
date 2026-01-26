import { Context, Effect } from 'effect';

import type { Agent } from '../agent/service.ts';
import type { Collections } from '../collections/service.ts';
import type { Config } from '../config/index.ts';
import type { Resources } from '../resources/service.ts';

export type ServerServices = {
	config: Config.Service;
	resources: Resources.Service;
	collections: Collections.Service;
	agent: Agent.Service;
};

export class ConfigService extends Context.Tag('ConfigService')<ConfigService, Config.Service>() {}
export class ResourcesService extends Context.Tag(
	'ResourcesService'
)<ResourcesService, Resources.Service>() {}
export class CollectionsService extends Context.Tag(
	'CollectionsService'
)<CollectionsService, Collections.Service>() {}
export class AgentService extends Context.Tag('AgentService')<AgentService, Agent.Service>() {}

export const provideServerServices = (services: ServerServices) =>
	Effect.provideService(ConfigService, services.config).pipe(
		Effect.provideService(ResourcesService, services.resources),
		Effect.provideService(CollectionsService, services.collections),
		Effect.provideService(AgentService, services.agent)
	);

export const runWithServerServices = async <A>(
	services: ServerServices,
	effect: Effect.Effect<
		A,
		unknown,
		Config.Service | Resources.Service | Collections.Service | Agent.Service
	>
): Promise<A> => {
	return Effect.runPromise(effect.pipe(provideServerServices(services)));
};

export const getConfigService = Effect.service(ConfigService);
export const getResourcesService = Effect.service(ResourcesService);
export const getCollectionsService = Effect.service(CollectionsService);
export const getAgentService = Effect.service(AgentService);
