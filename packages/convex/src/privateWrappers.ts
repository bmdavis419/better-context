import {
	ConvexError,
	v,
	type GenericValidator,
	type ObjectType,
	type PropertyValidators
} from 'convex/values';

import { action, mutation, query } from './_generated/server';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';

const privateApiKeyField = { privateApiKey: v.string() } as const;

type ReturnsValidator = GenericValidator | PropertyValidators | void;
type PrivateQueryConfig<Args extends PropertyValidators, Returns extends ReturnsValidator> = {
	args: Args;
	returns?: Returns;
	handler: (ctx: QueryCtx, args: ObjectType<Args>) => Promise<unknown> | unknown;
};
type PrivateMutationConfig<Args extends PropertyValidators, Returns extends ReturnsValidator> = {
	args: Args;
	returns?: Returns;
	handler: (ctx: MutationCtx, args: ObjectType<Args>) => Promise<unknown> | unknown;
};
type PrivateActionConfig<Args extends PropertyValidators, Returns extends ReturnsValidator> = {
	args: Args;
	returns?: Returns;
	handler: (ctx: ActionCtx, args: ObjectType<Args>) => Promise<unknown> | unknown;
};

const getPrivateApiKey = () => {
	const privateApiKey = process.env.CONVEX_API_KEY;
	if (!privateApiKey) {
		throw new ConvexError({
			code: 'CONFIG_MISSING',
			message: 'CONVEX_API_KEY is not configured'
		});
	}
	return privateApiKey;
};

const validatePrivateApiKey = (privateApiKey: string) => {
	if (privateApiKey !== getPrivateApiKey()) {
		throw new ConvexError({
			code: 'UNAUTHORIZED',
			message: 'Invalid private API key'
		});
	}
};

const withPrivateArgs = <Args extends PropertyValidators>(args: Args) =>
	({ ...args, ...privateApiKeyField }) as Args & typeof privateApiKeyField;

const stripPrivateApiKey = <Args extends { privateApiKey: string }>(args: Args) => {
	const { privateApiKey: _privateApiKey, ...rest } = args;
	return rest as Omit<Args, 'privateApiKey'>;
};

export const withPrivateApiKey = <Args extends Record<string, unknown>>(args: Args) => ({
	...args,
	privateApiKey: getPrivateApiKey()
});

export const privateQuery = <Args extends PropertyValidators, Returns extends ReturnsValidator>(
	config: PrivateQueryConfig<Args, Returns>
) =>
	query({
		args: withPrivateArgs(config.args),
		...(config.returns === undefined ? {} : { returns: config.returns }),
		handler: (async (ctx: QueryCtx, args: ObjectType<Args> & { privateApiKey: string }) => {
			validatePrivateApiKey(args.privateApiKey);
			return await config.handler(ctx, stripPrivateApiKey(args) as unknown as ObjectType<Args>);
		}) as never
	});

export const privateMutation = <Args extends PropertyValidators, Returns extends ReturnsValidator>(
	config: PrivateMutationConfig<Args, Returns>
) =>
	mutation({
		args: withPrivateArgs(config.args),
		...(config.returns === undefined ? {} : { returns: config.returns }),
		handler: (async (ctx: MutationCtx, args: ObjectType<Args> & { privateApiKey: string }) => {
			validatePrivateApiKey(args.privateApiKey);
			return await config.handler(ctx, stripPrivateApiKey(args) as unknown as ObjectType<Args>);
		}) as never
	});

export const privateAction = <Args extends PropertyValidators, Returns extends ReturnsValidator>(
	config: PrivateActionConfig<Args, Returns>
) =>
	action({
		args: withPrivateArgs(config.args),
		...(config.returns === undefined ? {} : { returns: config.returns }),
		handler: (async (ctx: ActionCtx, args: ObjectType<Args> & { privateApiKey: string }) => {
			validatePrivateApiKey(args.privateApiKey);
			return await config.handler(ctx, stripPrivateApiKey(args) as unknown as ObjectType<Args>);
		}) as never
	});
