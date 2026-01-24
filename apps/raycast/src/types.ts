import { z } from 'zod';

// API Response types
export const ResourceSchema = z.object({
	name: z.string(),
	displayName: z.string(),
	isGlobal: z.boolean()
});

export const ResourcesResponseSchema = z.object({
	resources: z.array(ResourceSchema)
});

export type Resource = z.infer<typeof ResourceSchema>;
export type ResourcesResponse = z.infer<typeof ResourcesResponseSchema>;

// Stream event types
export const StreamEventSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('text'),
		delta: z.string()
	}),
	z.object({
		type: z.literal('done'),
		text: z.string()
	}),
	z.object({
		type: z.literal('error'),
		message: z.string()
	})
]);

export type StreamEvent = z.infer<typeof StreamEventSchema>;

// Error response
export const ErrorResponseSchema = z.object({
	error: z.string(),
	upgradeUrl: z.string().optional()
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
