'use node';

import { internal } from '../_generated/api.js';
import type { Doc } from '../_generated/dataModel.js';
import { internalAction, type ActionCtx } from '../_generated/server.js';
import { instances, scheduled } from '../apiHelpers.js';

const instanceMutations = instances.mutations;

const BTCA_PACKAGE_NAME = 'btca';
const OPENCODE_PACKAGE_NAME = 'opencode-ai';

type VersionCheckResult = {
	checked: number;
	latestBtca: string | undefined;
	latestOpencode: string | undefined;
};

export const checkVersions = internalAction({
	args: {},
	handler: async (ctx): Promise<VersionCheckResult> => {
		const [latestBtca, latestOpencode] = await Promise.all([
			fetchLatestVersion(BTCA_PACKAGE_NAME),
			fetchLatestVersion(OPENCODE_PACKAGE_NAME)
		]);

		if (!latestBtca && !latestOpencode) {
			console.error('Scheduled version check failed to fetch latest versions');
			return { checked: 0, latestBtca, latestOpencode };
		}

		const instances = await ctx.runQuery(scheduled.queries.listInstances, {});
		for (const instance of instances) {
			await updateInstance(ctx, instance, latestBtca, latestOpencode);
		}
		return { checked: instances.length, latestBtca, latestOpencode };
	}
});

async function updateInstance(
	ctx: ActionCtx,
	instance: Doc<'instances'>,
	latestBtca?: string,
	latestOpencode?: string
): Promise<void> {
	try {
		await ctx.runMutation(instanceMutations.setVersions, {
			instanceId: instance._id,
			latestBtcaVersion: latestBtca,
			latestOpencodeVersion: latestOpencode,
			lastVersionCheck: Date.now()
		});
	} catch (error) {
		console.error('Scheduled version check failed', error);
	}
}

async function fetchLatestVersion(packageName: string): Promise<string | undefined> {
	try {
		const response = await fetch(`https://registry.npmjs.org/${packageName}/latest`);
		if (!response.ok) return undefined;
		const data = (await response.json()) as { version?: string };
		return data.version;
	} catch {
		return undefined;
	}
}
