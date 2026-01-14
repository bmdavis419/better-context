import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { ConvexClient } from 'convex/browser';

// Create a single Convex client instance for the app
export const convex = new ConvexClient(PUBLIC_CONVEX_URL);
