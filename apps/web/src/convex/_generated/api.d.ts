/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from '../analytics.js';
import type * as analyticsEvents from '../analyticsEvents.js';
import type * as apiHelpers from '../apiHelpers.js';
import type * as authHelpers from '../authHelpers.js';
import type * as clerkApiKeys from '../clerkApiKeys.js';
import type * as clerkApiKeysQueries from '../clerkApiKeysQueries.js';
import type * as cli from '../cli.js';
import type * as cliInternal from '../cliInternal.js';
import type * as crons from '../crons.js';
import type * as http from '../http.js';
import type * as instances_actions from '../instances/actions.js';
import type * as instances_mutations from '../instances/mutations.js';
import type * as instances_queries from '../instances/queries.js';
import type * as mcp from '../mcp.js';
import type * as mcpInternal from '../mcpInternal.js';
import type * as mcpQuestions from '../mcpQuestions.js';
import type * as messages from '../messages.js';
import type * as migrations from '../migrations.js';
import type * as projects from '../projects.js';
import type * as resources from '../resources.js';
import type * as scheduled_queries from '../scheduled/queries.js';
import type * as scheduled_updates from '../scheduled/updates.js';
import type * as scheduled_versionCheck from '../scheduled/versionCheck.js';
import type * as seed from '../seed.js';
import type * as streamSessions from '../streamSessions.js';
import type * as threadTitle from '../threadTitle.js';
import type * as threads from '../threads.js';
import type * as usage from '../usage.js';
import type * as users from '../users.js';

import type { ApiFromModules, FilterApi, FunctionReference } from 'convex/server';

declare const fullApi: ApiFromModules<{
	analytics: typeof analytics;
	analyticsEvents: typeof analyticsEvents;
	apiHelpers: typeof apiHelpers;
	authHelpers: typeof authHelpers;
	clerkApiKeys: typeof clerkApiKeys;
	clerkApiKeysQueries: typeof clerkApiKeysQueries;
	cli: typeof cli;
	cliInternal: typeof cliInternal;
	crons: typeof crons;
	http: typeof http;
	'instances/actions': typeof instances_actions;
	'instances/mutations': typeof instances_mutations;
	'instances/queries': typeof instances_queries;
	mcp: typeof mcp;
	mcpInternal: typeof mcpInternal;
	mcpQuestions: typeof mcpQuestions;
	messages: typeof messages;
	migrations: typeof migrations;
	projects: typeof projects;
	resources: typeof resources;
	'scheduled/queries': typeof scheduled_queries;
	'scheduled/updates': typeof scheduled_updates;
	'scheduled/versionCheck': typeof scheduled_versionCheck;
	seed: typeof seed;
	streamSessions: typeof streamSessions;
	threadTitle: typeof threadTitle;
	threads: typeof threads;
	usage: typeof usage;
	users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, 'public'>>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, 'internal'>>;

export declare const components: {
	migrations: {
		lib: {
			cancel: FunctionReference<
				'mutation',
				'internal',
				{ name: string },
				{
					batchSize?: number;
					cursor?: string | null;
					error?: string;
					isDone: boolean;
					latestEnd?: number;
					latestStart: number;
					name: string;
					next?: Array<string>;
					processed: number;
					state: 'inProgress' | 'success' | 'failed' | 'canceled' | 'unknown';
				}
			>;
			cancelAll: FunctionReference<
				'mutation',
				'internal',
				{ sinceTs?: number },
				Array<{
					batchSize?: number;
					cursor?: string | null;
					error?: string;
					isDone: boolean;
					latestEnd?: number;
					latestStart: number;
					name: string;
					next?: Array<string>;
					processed: number;
					state: 'inProgress' | 'success' | 'failed' | 'canceled' | 'unknown';
				}>
			>;
			clearAll: FunctionReference<'mutation', 'internal', { before?: number }, null>;
			getStatus: FunctionReference<
				'query',
				'internal',
				{ limit?: number; names?: Array<string> },
				Array<{
					batchSize?: number;
					cursor?: string | null;
					error?: string;
					isDone: boolean;
					latestEnd?: number;
					latestStart: number;
					name: string;
					next?: Array<string>;
					processed: number;
					state: 'inProgress' | 'success' | 'failed' | 'canceled' | 'unknown';
				}>
			>;
			migrate: FunctionReference<
				'mutation',
				'internal',
				{
					batchSize?: number;
					cursor?: string | null;
					dryRun: boolean;
					fnHandle: string;
					name: string;
					next?: Array<{ fnHandle: string; name: string }>;
					oneBatchOnly?: boolean;
				},
				{
					batchSize?: number;
					cursor?: string | null;
					error?: string;
					isDone: boolean;
					latestEnd?: number;
					latestStart: number;
					name: string;
					next?: Array<string>;
					processed: number;
					state: 'inProgress' | 'success' | 'failed' | 'canceled' | 'unknown';
				}
			>;
		};
	};
};
