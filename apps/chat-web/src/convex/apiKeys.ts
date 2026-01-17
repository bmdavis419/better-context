import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { nanoid } from 'nanoid';

function generateApiKey(): string {
	return `btca_${nanoid(32)}`;
}

async function hashApiKey(key: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(key);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const create = mutation({
	args: {
		userId: v.id('users'),
		name: v.string()
	},
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (!user) throw new Error('User not found');

		const plainKey = generateApiKey();
		const keyHash = await hashApiKey(plainKey);
		const keyPrefix = `${plainKey.slice(0, 12)}...`;

		const keyId = await ctx.db.insert('apiKeys', {
			userId: args.userId,
			name: args.name,
			keyHash,
			keyPrefix,
			createdAt: Date.now()
		});

		return { key: plainKey, keyId, keyPrefix };
	}
});

export const listByUser = query({
	args: {
		userId: v.id('users')
	},
	handler: async (ctx, args) => {
		const keys = await ctx.db
			.query('apiKeys')
			.withIndex('by_user', (q) => q.eq('userId', args.userId))
			.collect();

		return keys.map((key) => ({
			_id: key._id,
			name: key.name,
			keyPrefix: key.keyPrefix,
			createdAt: key.createdAt,
			lastUsedAt: key.lastUsedAt,
			revokedAt: key.revokedAt
		}));
	}
});

export const revoke = mutation({
	args: {
		userId: v.id('users'),
		keyId: v.id('apiKeys')
	},
	handler: async (ctx, args) => {
		const key = await ctx.db.get(args.keyId);
		if (!key) throw new Error('API key not found');
		if (key.userId !== args.userId) throw new Error('Unauthorized');

		await ctx.db.patch(args.keyId, {
			revokedAt: Date.now()
		});
	}
});

export const validate = query({
	args: {
		apiKey: v.string()
	},
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
			return { valid: false as const, error: 'API key revoked' };
		}
		return {
			valid: true as const,
			keyId: key._id,
			userId: key.userId
		};
	}
});

export const touchLastUsed = mutation({
	args: {
		keyId: v.id('apiKeys')
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.keyId, { lastUsedAt: Date.now() });
	}
});
