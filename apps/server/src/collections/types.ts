export type CollectionResult = {
	path: string;
	agentInstructions: string;
};

export class CollectionError extends Error {
	readonly _tag = 'CollectionError';
	override readonly cause?: unknown;

	constructor(args: { message: string; cause?: unknown }) {
		super(args.message);
		this.cause = args.cause;
	}
}

export const getCollectionKey = (resourceNames: readonly string[]): string => {
	return [...resourceNames].sort().join('+');
};
