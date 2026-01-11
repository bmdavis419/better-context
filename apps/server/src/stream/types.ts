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
		input: z.record(z.unknown()),
		raw: z.string()
	}),
	z.object({
		status: z.literal('running'),
		input: z.record(z.unknown()),
		title: z.string().optional(),
		metadata: z.record(z.unknown()).optional(),
		time: z.object({ start: z.number() })
	}),
	z.object({
		status: z.literal('completed'),
		input: z.record(z.unknown()),
		output: z.string(),
		title: z.string(),
		metadata: z.record(z.unknown()),
		time: z.object({ start: z.number(), end: z.number(), compacted: z.number().optional() })
	}),
	z.object({
		status: z.literal('error'),
		input: z.record(z.unknown()),
		error: z.string(),
		metadata: z.record(z.unknown()).optional(),
		time: z.object({ start: z.number(), end: z.number() })
	})
]);

export const BtcaStreamToolUpdatedEventSchema = z.object({
	type: z.literal('tool.updated'),
	callID: z.string(),
	tool: z.string(),
	state: BtcaToolStateSchema
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
	)
});

export const BtcaStreamErrorEventSchema = z.object({
	type: z.literal('error'),
	tag: z.string(),
	message: z.string()
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
