import { ConvexError } from 'convex/values';
import { Result } from 'better-result';

import type { QueryCtx, MutationCtx, ActionCtx } from './_generated/server';
import type { Id, Doc } from './_generated/dataModel';
import { instances } from './apiHelpers';
import { WebAuthError } from '../lib/result/errors';

type DbCtx = QueryCtx | MutationCtx;
type AuthContextError = WebAuthError;
type AuthResult<T> = Result<T, AuthContextError>;
type ConvexAuthErrorPayload = {
	code: 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND';
	message: string;
};

const unauthorizedError = () =>
	new WebAuthError({
		message: 'Authentication required',
		code: 'UNAUTHORIZED'
	});

const forbiddenError = (message = 'Access denied') =>
	new WebAuthError({
		message,
		code: 'FORBIDDEN'
	});

const notFoundError = (message: string) => new WebAuthError({ message, code: 'NOT_FOUND' });

export const asConvexAuthError = (error: AuthContextError): ConvexError<ConvexAuthErrorPayload> =>
	new ConvexError({
		code:
			error.code === 'UNAUTHORIZED'
				? 'UNAUTHORIZED'
				: error.code === 'FORBIDDEN'
					? 'FORBIDDEN'
					: 'NOT_FOUND',
		message: error.message
	});

export const unwrapAuthResult = async <T>(result: AuthResult<T>): Promise<T> => {
	if (Result.isError(result)) {
		throw asConvexAuthError(result.error);
	}
	return result.value;
};

const assertAuthenticated = async (ctx: DbCtx): Promise<AuthResult<string>> => {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		return Result.err(unauthorizedError());
	}
	return Result.ok(identity.subject);
};

const getInstanceById = async (
	ctx: DbCtx,
	instanceId: Id<'instances'>
): Promise<AuthResult<Doc<'instances'>>> => {
	const instance = await ctx.db.get(instanceId);
	if (!instance) {
		return Result.err(notFoundError('Instance not found'));
	}
	return Result.ok(instance);
};

const getInstanceForUser = async (
	ctx: DbCtx,
	instanceId: Id<'instances'>
): Promise<AuthResult<Doc<'instances'>>> => {
	const subject = await assertAuthenticated(ctx);
	if (Result.isError(subject)) {
		return subject;
	}

	const instance = await getInstanceById(ctx, instanceId);
	if (Result.isError(instance)) {
		return instance;
	}

	if (instance.value.clerkId !== subject.value) {
		return Result.err(forbiddenError());
	}

	return Result.ok(instance.value);
};

/**
 * Gets the authenticated user's instance, or returns a Result error.
 */
export async function getAuthenticatedInstanceResult(
	ctx: DbCtx
): Promise<AuthResult<Doc<'instances'>>> {
	const identity = await assertAuthenticated(ctx);
	if (Result.isError(identity)) {
		return identity;
	}

	const instance = await ctx.db
		.query('instances')
		.withIndex('by_clerk_id', (q) => q.eq('clerkId', identity.value))
		.first();

	if (!instance) {
		return Result.err(notFoundError('Instance not found for authenticated user'));
	}

	return Result.ok(instance);
}

/**
 * Gets the authenticated user's instance, or throws for compatibility.
 */
export async function getAuthenticatedInstance(ctx: DbCtx): Promise<Doc<'instances'>> {
	return unwrapAuthResult(await getAuthenticatedInstanceResult(ctx));
}

/**
 * Validates that the authenticated user owns the specified instance.
 */
export async function requireInstanceOwnershipResult(
	ctx: DbCtx,
	instanceId: Id<'instances'>
): Promise<AuthResult<Doc<'instances'>>> {
	return getInstanceForUser(ctx, instanceId);
}

/**
 * Validates that the authenticated user owns the specified instance.
 * Returns the instance if ownership is confirmed.
 */
export async function requireInstanceOwnership(
	ctx: DbCtx,
	instanceId: Id<'instances'>
): Promise<Doc<'instances'>> {
	return unwrapAuthResult(await requireInstanceOwnershipResult(ctx, instanceId));
}

/**
 * Validates that the authenticated user owns the thread (via its instance).
 */
export async function requireThreadOwnershipResult(
	ctx: DbCtx,
	threadId: Id<'threads'>
): Promise<AuthResult<{ thread: Doc<'threads'>; instance: Doc<'instances'> }>> {
	const subject = await assertAuthenticated(ctx);
	if (Result.isError(subject)) {
		return subject;
	}

	const thread = await ctx.db.get(threadId);
	if (!thread) {
		return Result.err(notFoundError('Thread not found'));
	}

	const instanceResult = await getInstanceById(ctx, thread.instanceId);
	if (Result.isError(instanceResult)) {
		return instanceResult;
	}

	if (instanceResult.value.clerkId !== subject.value) {
		return Result.err(forbiddenError());
	}

	return Result.ok({ thread, instance: instanceResult.value });
}

/**
 * Validates that the authenticated user owns the thread (via its instance).
 */
export async function requireThreadOwnership(
	ctx: DbCtx,
	threadId: Id<'threads'>
): Promise<{ thread: Doc<'threads'>; instance: Doc<'instances'> }> {
	return unwrapAuthResult(await requireThreadOwnershipResult(ctx, threadId));
}

/**
 * Validates that the authenticated user owns the message (via its thread's instance).
 */
export async function requireMessageOwnershipResult(
	ctx: DbCtx,
	messageId: Id<'messages'>
): Promise<
	AuthResult<{ message: Doc<'messages'>; thread: Doc<'threads'>; instance: Doc<'instances'> }>
> {
	const subject = await assertAuthenticated(ctx);
	if (Result.isError(subject)) {
		return subject;
	}

	const message = await ctx.db.get(messageId);
	if (!message) {
		return Result.err(notFoundError('Message not found'));
	}

	const thread = await ctx.db.get(message.threadId);
	if (!thread) {
		return Result.err(notFoundError('Thread not found'));
	}

	const instanceResult = await getInstanceById(ctx, thread.instanceId);
	if (Result.isError(instanceResult)) {
		return instanceResult;
	}

	if (instanceResult.value.clerkId !== subject.value) {
		return Result.err(forbiddenError());
	}

	return Result.ok({ message, thread, instance: instanceResult.value });
}

/**
 * Validates that the authenticated user owns the message (via its thread's instance).
 */
export async function requireMessageOwnership(
	ctx: DbCtx,
	messageId: Id<'messages'>
): Promise<{ message: Doc<'messages'>; thread: Doc<'threads'>; instance: Doc<'instances'> }> {
	return unwrapAuthResult(await requireMessageOwnershipResult(ctx, messageId));
}

/**
 * Validates that the authenticated user owns the user resource (via its instance).
 */
export async function requireUserResourceOwnershipResult(
	ctx: DbCtx,
	resourceId: Id<'userResources'>
): Promise<AuthResult<{ resource: Doc<'userResources'>; instance: Doc<'instances'> }>> {
	const subject = await assertAuthenticated(ctx);
	if (Result.isError(subject)) {
		return subject;
	}

	const resource = await ctx.db.get(resourceId);
	if (!resource) {
		return Result.err(notFoundError('Resource not found'));
	}

	const instance = await getInstanceById(ctx, resource.instanceId);
	if (Result.isError(instance)) {
		return instance;
	}

	if (instance.value.clerkId !== subject.value) {
		return Result.err(forbiddenError());
	}

	return Result.ok({ resource, instance: instance.value });
}

/**
 * Validates that the authenticated user owns the user resource (via its instance).
 */
export async function requireUserResourceOwnership(
	ctx: DbCtx,
	resourceId: Id<'userResources'>
): Promise<{ resource: Doc<'userResources'>; instance: Doc<'instances'> }> {
	return unwrapAuthResult(await requireUserResourceOwnershipResult(ctx, resourceId));
}

/**
 * For actions: Validates that the authenticated user owns the specified instance.
 */
export async function requireInstanceOwnershipActionResult(
	ctx: ActionCtx,
	instanceId: Id<'instances'>
): Promise<AuthResult<Doc<'instances'>>> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		return Result.err(unauthorizedError());
	}

	const instance = await ctx.runQuery(instances.internalQueries.getInternal, { id: instanceId });
	if (!instance) {
		return Result.err(notFoundError('Instance not found'));
	}

	if (instance.clerkId !== identity.subject) {
		return Result.err(forbiddenError());
	}

	return Result.ok(instance);
}

/**
 * For actions: Validates that the authenticated user owns the specified instance.
 */
export async function requireInstanceOwnershipAction(
	ctx: ActionCtx,
	instanceId: Id<'instances'>
): Promise<Doc<'instances'>> {
	return unwrapAuthResult(await requireInstanceOwnershipActionResult(ctx, instanceId));
}
