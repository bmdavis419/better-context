export class ResourceError extends Error {
	readonly _tag = 'ResourceError';
	override readonly cause?: unknown;

	constructor(args: { message: string; cause?: unknown; stack?: string }) {
		super(args.message);
		this.cause = args.cause;
		if (args.stack) this.stack = args.stack;
	}
}
