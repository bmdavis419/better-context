import { cronJobs } from 'convex/server';

import { internal } from './_generated/api.js';

const crons = cronJobs();

crons.cron('nightly-updates', '0 3 * * *', internal.scheduled.updates.runUpdates, {});
crons.interval('version-check', { hours: 6 }, internal.scheduled.versionCheck.checkVersions, {});

export default crons;
