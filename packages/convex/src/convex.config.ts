import { defineApp } from 'convex/server';
import migrations from '@convex-dev/migrations/convex.config.js';

const app = defineApp();
app.use(migrations);

export default app;
