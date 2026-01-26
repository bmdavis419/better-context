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
	instances: defineTable({
		clerkId: v.string(),
		sandboxId: v.optional(v.string()),
		state: v.union(
			v.literal('unprovisioned'),
			v.literal('provisioning'),
			v.literal('stopped'),
			v.literal('starting'),
			v.literal('running'),
			v.literal('stopping'),
			v.literal('updating'),
			v.literal('error')
		),
		serverUrl: v.optional(v.string()),
		errorMessage: v.optional(v.string()),
		btcaVersion: v.optional(v.string()),
		opencodeVersion: v.optional(v.string()),
		latestBtcaVersion: v.optional(v.string()),
		latestOpencodeVersion: v.optional(v.string()),
		lastVersionCheck: v.optional(v.number()),
		subscriptionPlan: v.optional(v.union(v.literal('pro'), v.literal('free'), v.literal('none'))),
		subscriptionStatus: v.optional(
			v.union(v.literal('active'), v.literal('trialing'), v.literal('canceled'), v.literal('none'))
		),
		subscriptionProductId: v.optional(v.string()),
		subscriptionCurrentPeriodEnd: v.optional(v.number()),
		subscriptionCanceledAt: v.optional(v.number()),
		subscriptionUpdatedAt: v.optional(v.number()),
		storageUsedBytes: v.optional(v.number()),
		lastActiveAt: v.optional(v.number()),
		provisionedAt: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_clerk_id', ['clerkId'])
		.index('by_sandbox_id', ['sandboxId']),

	cachedResources: defineTable({
		instanceId: v.id('instances'),
		name: v.string(),
		url: v.string(),
		branch: v.string(),
		sizeBytes: v.optional(v.number()),
		cachedAt: v.number(),
		lastUsedAt: v.number()
	}).index('by_instance', ['instanceId']),

	apiKeys: defineTable({
		instanceId: v.id('instances'),
		name: v.string(),
		keyHash: v.string(),
		keyPrefix: v.string(),
		createdAt: v.number(),
		lastUsedAt: v.optional(v.number()),
		revokedAt: v.optional(v.number()),
		usageCount: v.optional(v.number())
	})
		.index('by_instance', ['instanceId'])
		.index('by_key_hash', ['keyHash']),

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

	userResources: defineTable({
		instanceId: v.id('instances'),
		name: v.string(),
		type: v.literal('git'),
		url: v.string(),
		branch: v.string(),
		searchPath: v.optional(v.string()),
		specialNotes: v.optional(v.string()),
		createdAt: v.number()
	}).index('by_instance', ['instanceId']),

	threads: defineTable({
		instanceId: v.id('instances'),
		title: v.optional(v.string()),
		createdAt: v.number(),
		lastActivityAt: v.number()
	}).index('by_instance', ['instanceId']),

	messages: defineTable({
		threadId: v.id('threads'),
		role: v.union(v.literal('user'), v.literal('assistant'), v.literal('system')),
		content: messageContentValidator,
		resources: v.optional(v.array(v.string())),
		canceled: v.optional(v.boolean()),
		createdAt: v.number()
	}).index('by_thread', ['threadId']),

	threadResources: defineTable({
		threadId: v.id('threads'),
		resourceName: v.string()
	}).index('by_thread', ['threadId']),

	streamSessions: defineTable({
		threadId: v.id('threads'),
		messageId: v.id('messages'),
		sessionId: v.string(),
		status: v.union(v.literal('streaming'), v.literal('done'), v.literal('error')),
		startedAt: v.number(),
		completedAt: v.optional(v.number()),
		error: v.optional(v.string())
	})
		.index('by_thread', ['threadId'])
		.index('by_message', ['messageId'])
		.index('by_session', ['sessionId'])
		.index('by_status', ['status'])
});
