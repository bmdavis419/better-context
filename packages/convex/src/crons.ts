import { cronJobs } from 'convex/server';

import { api, internal } from './_generated/api.js';
import { withPrivateApiKey } from './privateWrappers.js';

const crons = cronJobs();

crons.cron('nightly-updates', '0 3 * * *', internal.scheduled.updates.runUpdates, {});
crons.interval('version-check', { hours: 6 }, internal.scheduled.versionCheck.checkVersions, {});
crons.interval(
	'cleanup-stream-sessions',
	{ minutes: 15 },
	api.streamSessions.cleanupOld,
	withPrivateApiKey({})
);

export default crons;
