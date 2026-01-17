import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// BtcaChunk type for message content
const btcaChunkValidator = v.union(
	v.object({
		type: v.literal('text'),
		id: v.string(),
		text: v.string()
	}),
	v.object({
		type: v.literal('reasoning'),
		id: v.string(),
		text: v.string()
	}),
	v.object({
		type: v.literal('tool'),
		id: v.string(),
		toolName: v.string(),
		state: v.union(v.literal('pending'), v.literal('running'), v.literal('completed'))
	}),
	v.object({
		type: v.literal('file'),
		id: v.string(),
		filePath: v.string()
	})
);

// Message content can be a string or structured chunks
const messageContentValidator = v.union(
	v.string(),
	v.object({
		type: v.literal('chunks'),
		chunks: v.array(btcaChunkValidator)
	})
);

export default defineSchema({
	// Users (synced from Clerk)
	users: defineTable({
		clerkId: v.string(),
		email: v.string(),
		name: v.optional(v.string()),
		imageUrl: v.optional(v.string()),
		sandboxLastActiveAt: v.optional(v.number()),
		mcpSandboxId: v.optional(v.string()),
		mcpLastUsedAt: v.optional(v.number()),
		createdAt: v.number()
	}).index('by_clerk_id', ['clerkId']),

	// API keys for MCP access
	apiKeys: defineTable({
		userId: v.id('users'),
		name: v.string(),
		keyHash: v.string(),
		keyPrefix: v.string(),
		createdAt: v.number(),
		lastUsedAt: v.optional(v.number()),
		revokedAt: v.optional(v.number())
	})
		.index('by_user', ['userId'])
		.index('by_key_hash', ['keyHash']),

	// Global resource catalog (admin-managed)
	globalResources: defineTable({
		name: v.string(),
		displayName: v.string(),
		type: v.literal('git'),
		url: v.string(),
		branch: v.string(),
		searchPath: v.optional(v.string()),
		specialNotes: v.optional(v.string()),
		isActive: v.boolean()
	}).index('by_name', ['name']),

	// User's personal resources (custom additions)
	userResources: defineTable({
		userId: v.id('users'),
		name: v.string(),
		type: v.literal('git'),
		url: v.string(),
		branch: v.string(),
		searchPath: v.optional(v.string()),
		specialNotes: v.optional(v.string()),
		createdAt: v.number()
	}).index('by_user', ['userId']),

	// Chat threads - sandboxId is the only sandbox info stored
	// Sandbox state is derived from Daytona on each request
	threads: defineTable({
		userId: v.id('users'),
		title: v.optional(v.string()),
		sandboxId: v.optional(v.string()),
		createdAt: v.number(),
		lastActivityAt: v.number()
	})
		.index('by_user', ['userId'])
		.index('by_user_recent', ['userId', 'lastActivityAt'])
		.index('by_sandbox_id', ['sandboxId']),

	// Messages within threads
	messages: defineTable({
		threadId: v.id('threads'),
		role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
		content: messageContentValidator,
		resources: v.optional(v.array(v.string())),
		canceled: v.optional(v.boolean()),
		createdAt: v.number()
	}).index('by_thread', ['threadId']),

	// Active resources per thread (many-to-many)
	threadResources: defineTable({
		threadId: v.id('threads'),
		resourceName: v.string()
	}).index('by_thread', ['threadId'])
});
