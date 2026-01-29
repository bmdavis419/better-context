export const formatError = (error: unknown): string => {
	if (error && typeof error === 'object') {
		const details = error as { message?: string; hint?: string };
		const message =
			typeof details.message === 'string' && details.message.length > 0
				? details.message
				: String(error);
		if (typeof details.hint === 'string' && details.hint.length > 0) {
			return `${message}\n\nHint: ${details.hint}`;
		}
		return message;
	}
	return String(error);
};
