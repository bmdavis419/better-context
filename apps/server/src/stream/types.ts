import { z } from 'zod';

export const BtcaModelSchema = z.object({
	provider: z.string(),
	model: z.string()
});

export const BtcaCollectionInfoSchema = z.object({
	key: z.string(),
	path: z.string()
});

export const BtcaStreamMetaEventSchema = z.object({
	type: z.literal('meta'),
	model: BtcaModelSchema,
	resources: z.array(z.string()),
	collection: BtcaCollectionInfoSchema
});

export const BtcaStreamTextDeltaEventSchema = z.object({
	type: z.literal('text.delta'),
	delta: z.string()
});

export const BtcaStreamReasoningDeltaEventSchema = z.object({
	type: z.literal('reasoning.delta'),
	delta: z.string()
});

export const BtcaToolStateSchema = z.discriminatedUnion('status', [
	z.object({
		status: z.literal('pending'),
		input: z.unknown(),
		raw: z.string().optional()
	}),
	z.object({
		status: z.literal('running'),
		input: z.unknown(),
		title: z.string().optional(),
		metadata: z.record(z.unknown()).optional(),
		time: z.object({ start: z.number() }).optional()
	}),
	z.object({
		status: z.literal('completed'),
		input: z.unknown(),
		output: z.string(),
		title: z.string().optional(),
		metadata: z.record(z.unknown()).optional(),
		time: z
			.object({ start: z.number(), end: z.number(), compacted: z.number().optional() })
			.optional()
	}),
	z.object({
		status: z.literal('error'),
		input: z.unknown(),
		error: z.string(),
		metadata: z.record(z.unknown()).optional(),
		time: z.object({ start: z.number(), end: z.number() }).optional()
	})
]);

export const BtcaStreamToolUpdatedEventSchema = z.object({
	type: z.literal('tool.updated'),
	callID: z.string(),
	tool: z.string(),
	state: BtcaToolStateSchema
});

export const BtcaStreamUsageSchema = z.object({
	inputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
	reasoningTokens: z.number().optional(),
	totalTokens: z.number().optional()
});

export const BtcaStreamMetricsTimingSchema = z.object({
	totalMs: z.number().optional(),
	genMs: z.number().optional()
});

export const BtcaStreamMetricsThroughputSchema = z.object({
	outputTokensPerSecond: z.number().optional(),
	totalTokensPerSecond: z.number().optional()
});

export const BtcaStreamPricingRatesSchema = z.object({
	input: z.number().optional(),
	output: z.number().optional(),
	reasoning: z.number().optional(),
	cacheRead: z.number().optional(),
	cacheWrite: z.number().optional()
});

export const BtcaStreamPricingCostSchema = z.object({
	input: z.number().optional(),
	output: z.number().optional(),
	reasoning: z.number().optional(),
	total: z.number().optional()
});

export const BtcaStreamMetricsPricingSchema = z.object({
	source: z.literal('models.dev'),
	modelKey: z.string().optional(),
	ratesUsdPerMTokens: BtcaStreamPricingRatesSchema.optional(),
	costUsd: BtcaStreamPricingCostSchema.optional()
});

export const BtcaStreamMetricsSchema = z.object({
	timing: BtcaStreamMetricsTimingSchema.optional(),
	throughput: BtcaStreamMetricsThroughputSchema.optional(),
	pricing: BtcaStreamMetricsPricingSchema.optional()
});

export const BtcaStreamDoneEventSchema = z.object({
	type: z.literal('done'),
	text: z.string(),
	reasoning: z.string(),
	tools: z.array(
		z.object({
			callID: z.string(),
			tool: z.string(),
			state: BtcaToolStateSchema
		})
	),
	usage: BtcaStreamUsageSchema.optional(),
	metrics: BtcaStreamMetricsSchema.optional()
});

export const BtcaStreamErrorEventSchema = z.object({
	type: z.literal('error'),
	tag: z.string(),
	message: z.string(),
	hint: z.string().optional()
});

export const BtcaStreamEventSchema = z.union([
	BtcaStreamMetaEventSchema,
	BtcaStreamTextDeltaEventSchema,
	BtcaStreamReasoningDeltaEventSchema,
	BtcaStreamToolUpdatedEventSchema,
	BtcaStreamDoneEventSchema,
	BtcaStreamErrorEventSchema
]);

export type BtcaStreamMetaEvent = z.infer<typeof BtcaStreamMetaEventSchema>;
export type BtcaStreamTextDeltaEvent = z.infer<typeof BtcaStreamTextDeltaEventSchema>;
export type BtcaStreamReasoningDeltaEvent = z.infer<typeof BtcaStreamReasoningDeltaEventSchema>;
export type BtcaStreamToolUpdatedEvent = z.infer<typeof BtcaStreamToolUpdatedEventSchema>;
export type BtcaStreamDoneEvent = z.infer<typeof BtcaStreamDoneEventSchema>;
export type BtcaStreamErrorEvent = z.infer<typeof BtcaStreamErrorEventSchema>;
export type BtcaStreamEvent = z.infer<typeof BtcaStreamEventSchema>;
