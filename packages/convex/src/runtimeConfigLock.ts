const runtimeConfigLocks = new Map<string, Promise<void>>();

export const withInstanceRuntimeConfigLock = async <T>(
	instanceId: string,
	task: () => Promise<T>
): Promise<T> => {
	const previous = runtimeConfigLocks.get(instanceId) ?? Promise.resolve();
	let release = () => {};
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	const queued = previous.then(() => current);

	runtimeConfigLocks.set(instanceId, queued);

	await previous;

	try {
		return await task();
	} finally {
		release();
		if (runtimeConfigLocks.get(instanceId) === queued) {
			runtimeConfigLocks.delete(instanceId);
		}
	}
};
