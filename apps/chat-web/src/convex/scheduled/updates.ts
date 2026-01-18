'use node';

import type { Doc } from '../_generated/dataModel';
import { internalAction, type ActionCtx } from '../_generated/server.js';
import { instances as instancesApi, scheduled } from '../apiHelpers';

const instanceActions = instancesApi.actions;

const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const runUpdates = internalAction({
	args: {},
	handler: async (ctx): Promise<{ updated: number }> => {
		const cutoff = Date.now() - ACTIVE_WINDOW_MS;
		const instances = await ctx.runQuery(scheduled.queries.listActiveInstances, { cutoff });

		for (const instance of instances) {
			await updateInstance(ctx, instance);
		}

		return { updated: instances.length };
	}
});

async function updateInstance(ctx: ActionCtx, instance: Doc<'instances'>): Promise<void> {
	if (!instance.sandboxId) {
		return;
	}

	try {
		await ctx.runAction(instanceActions.update, { instanceId: instance._id });
	} catch (error) {
		console.error('Scheduled update failed', error);
	}
}
