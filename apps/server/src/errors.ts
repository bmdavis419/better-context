export type TaggedErrorLike = {
	readonly _tag: string;
	readonly message: string;
};

export const getErrorTag = (error: unknown): string => {
	if (error && typeof error === 'object' && '_tag' in error) return String((error as any)._tag);
	return 'UnknownError';
};

export const getErrorMessage = (error: unknown): string => {
	if (error && typeof error === 'object' && 'message' in error)
		return String((error as any).message);
	return String(error);
};
