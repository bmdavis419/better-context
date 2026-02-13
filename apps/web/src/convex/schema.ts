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

	projects: defineTable({
		instanceId: v.id('instances'),
		name: v.string(),
		model: v.optional(v.string()),
		isDefault: v.boolean(),
		createdAt: v.number()
	})
		.index('by_instance', ['instanceId'])
		.index('by_instance_and_name', ['instanceId', 'name']),

	cachedResources: defineTable({
		instanceId: v.id('instances'),
		projectId: v.optional(v.id('projects')),
		name: v.string(),
		type: v.optional(v.union(v.literal('git'), v.literal('npm'))),
		url: v.optional(v.string()),
		branch: v.optional(v.string()),
		package: v.optional(v.string()),
		version: v.optional(v.string()),
		sizeBytes: v.optional(v.number()),
		cachedAt: v.number(),
		lastUsedAt: v.number()
	})
		.index('by_instance', ['instanceId'])
		.index('by_project', ['projectId']),

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
		projectId: v.optional(v.id('projects')),
		name: v.string(),
		type: v.union(v.literal('git'), v.literal('npm')),
		url: v.optional(v.string()),
		branch: v.optional(v.string()),
		searchPath: v.optional(v.string()),
		package: v.optional(v.string()),
		version: v.optional(v.string()),
		specialNotes: v.optional(v.string()),
		createdAt: v.number()
	})
		.index('by_instance', ['instanceId'])
		.index('by_project', ['projectId'])
		.index('by_instance_and_name', ['instanceId', 'name'])
		.index('by_project_and_name', ['projectId', 'name']),

	threads: defineTable({
		instanceId: v.id('instances'),
		projectId: v.optional(v.id('projects')),
		title: v.optional(v.string()),
		createdAt: v.number(),
		lastActivityAt: v.number()
	})
		.index('by_instance', ['instanceId'])
		.index('by_project', ['projectId']),

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
		.index('by_thread_and_status', ['threadId', 'status']),

	mcpQuestions: defineTable({
		projectId: v.id('projects'),
		question: v.string(),
		resources: v.array(v.string()),
		answer: v.string(),
		createdAt: v.number()
	}).index('by_project', ['projectId']),

	apiKeyUsage: defineTable({
		clerkApiKeyId: v.string(), // "ak_xxx" from Clerk
		clerkUserId: v.string(), // "user_xxx" - the subject from Clerk
		instanceId: v.id('instances'),
		name: v.optional(v.string()), // Cached name for display
		lastUsedAt: v.optional(v.number()),
		usageCount: v.number(),
		createdAt: v.number()
	})
		.index('by_clerk_api_key_id', ['clerkApiKeyId'])
		.index('by_instance', ['instanceId'])
});
