const exitResolvers = new Set<() => void>();
let initialResources: string[] = [];

export const setInitialResources = (resources: string[]) => {
	initialResources = [...resources];
};

export const consumeInitialResources = () => {
	const resources = [...initialResources];
	initialResources = [];
	return resources;
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
