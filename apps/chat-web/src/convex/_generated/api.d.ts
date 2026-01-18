/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiHelpers from "../apiHelpers.js";
import type * as apiKeys from "../apiKeys.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as instances_actions from "../instances/actions.js";
import type * as instances_mutations from "../instances/mutations.js";
import type * as instances_queries from "../instances/queries.js";
import type * as messages from "../messages.js";
import type * as resources from "../resources.js";
import type * as scheduled_queries from "../scheduled/queries.js";
import type * as scheduled_updates from "../scheduled/updates.js";
import type * as scheduled_versionCheck from "../scheduled/versionCheck.js";
import type * as seed from "../seed.js";
import type * as threads from "../threads.js";
import type * as usage from "../usage.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  apiHelpers: typeof apiHelpers;
  apiKeys: typeof apiKeys;
  crons: typeof crons;
  http: typeof http;
  "instances/actions": typeof instances_actions;
  "instances/mutations": typeof instances_mutations;
  "instances/queries": typeof instances_queries;
  messages: typeof messages;
  resources: typeof resources;
  "scheduled/queries": typeof scheduled_queries;
  "scheduled/updates": typeof scheduled_updates;
  "scheduled/versionCheck": typeof scheduled_versionCheck;
  seed: typeof seed;
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
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
