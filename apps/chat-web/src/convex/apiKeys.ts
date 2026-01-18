import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

export const listByUser = query({
	args: { userId: v.id('instances') },
	handler: async (ctx, args) => {
		const keys = await ctx.db
			.query('apiKeys')
			.withIndex('by_instance', (q) => q.eq('instanceId', args.userId))
			.collect();

		return keys.map((k) => ({
			_id: k._id,
			name: k.name,
			keyPrefix: k.keyPrefix,
			createdAt: k.createdAt,
			lastUsedAt: k.lastUsedAt,
			revokedAt: k.revokedAt
		}));
	}
});

export const create = mutation({
	args: {
		userId: v.id('instances'),
		name: v.string()
	},
	handler: async (ctx, args) => {
		const key = generateApiKey();
		const keyHash = await hashApiKey(key);
		const keyPrefix = key.slice(0, 8);

		const id = await ctx.db.insert('apiKeys', {
			instanceId: args.userId,
			name: args.name,
			keyHash,
			keyPrefix,
			createdAt: Date.now()
		});

		return { id, key };
	}
});

function generateApiKey(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = 'btca_';
	for (let i = 0; i < 32; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

export const revoke = mutation({
	args: { keyId: v.id('apiKeys') },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.keyId, {
			revokedAt: Date.now()
		});
	}
});

export const validate = query({
	args: { apiKey: v.string() },
	handler: async (ctx, args) => {
		const keyHash = await hashApiKey(args.apiKey);

		const key = await ctx.db
			.query('apiKeys')
			.withIndex('by_key_hash', (q) => q.eq('keyHash', keyHash))
			.first();

		if (!key) {
			return { valid: false as const, error: 'Invalid API key' };
		}

		if (key.revokedAt) {
			return { valid: false as const, error: 'API key has been revoked' };
		}

		const instance = await ctx.db.get(key.instanceId);
		if (!instance) {
			return { valid: false as const, error: 'User not found' };
		}

		return {
			valid: true as const,
			keyId: key._id,
			userId: key.instanceId,
			clerkId: instance.clerkId
		};
	}
});

export const touchLastUsed = mutation({
	args: { keyId: v.id('apiKeys') },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.keyId, {
			lastUsedAt: Date.now()
		});
	}
});

async function hashApiKey(apiKey: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(apiKey);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
