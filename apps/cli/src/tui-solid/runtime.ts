let resolveExit: (() => void) | null = null;

export const createExitPromise = () =>
	new Promise<void>((resolve) => {
		resolveExit = resolve;
	});

export const notifyExit = () => {
	if (resolveExit) {
		resolveExit();
		resolveExit = null;
	}
};
