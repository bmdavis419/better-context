import type { FunctionReference } from 'convex/server';

import { api, internal } from './_generated/api';

type PublicQueryRef = FunctionReference<'query', 'public'>;
type PublicMutationRef = FunctionReference<'mutation', 'public'>;
type PublicActionRef = FunctionReference<'action', 'public'>;
type InternalQueryRef = FunctionReference<'query', 'internal'>;

type PublicQueryRecord = Record<string, PublicQueryRef>;
type PublicMutationRecord = Record<string, PublicMutationRef>;
type PublicActionRecord = Record<string, PublicActionRef>;
type InternalQueryRecord = Record<string, InternalQueryRef>;

type NestedApi = typeof api & {
	'instances/queries': PublicQueryRecord;
	'instances/mutations': PublicMutationRecord;
	'instances/actions': PublicActionRecord;
};

type NestedInternal = typeof internal & {
	'scheduled/queries': InternalQueryRecord;
};

type InstancesApi = {
	queries: PublicQueryRecord;
	mutations: PublicMutationRecord;
	actions: PublicActionRecord;
};

type ScheduledApi = {
	queries: InternalQueryRecord;
};

export const instances: InstancesApi = {
	queries: (api as NestedApi)['instances/queries'],
	mutations: (api as NestedApi)['instances/mutations'],
	actions: (api as NestedApi)['instances/actions']
};

export const scheduled: ScheduledApi = {
	queries: (internal as NestedInternal)['scheduled/queries']
};
