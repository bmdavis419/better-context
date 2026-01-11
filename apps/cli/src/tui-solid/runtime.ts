const exitResolvers = new Set<() => void>();
const initialResourcesQueue: string[][] = [];

export const setInitialResources = (resources: string[]) => {
	initialResourcesQueue.push([...resources]);
};

export const consumeInitialResources = () => {
	return initialResourcesQueue.shift() ?? [];
};

export const createExitPromise = () =>
	new Promise<void>((resolve) => {
		exitResolvers.add(resolve);
	});

export const notifyExit = () => {
	for (const resolve of exitResolvers) {
		resolve();
	}
	exitResolvers.clear();
};
