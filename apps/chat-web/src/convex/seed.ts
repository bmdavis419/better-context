import { mutation } from './_generated/server';

const INITIAL_GLOBAL_RESOURCES = [
	{
		name: 'svelte',
		displayName: 'Svelte',
		url: 'https://github.com/sveltejs/svelte.dev',
		branch: 'main',
		searchPath: 'apps/svelte.dev',
		specialNotes: 'Svelte docs website. Focus on content directory for markdown documentation.'
	},
	{
		name: 'svelteKit',
		displayName: 'SvelteKit',
		url: 'https://github.com/sveltejs/kit',
		branch: 'main',
		searchPath: 'documentation',
		specialNotes: 'SvelteKit docs. Focus on documentation directory.'
	},
	{
		name: 'tailwind',
		displayName: 'Tailwind CSS',
		url: 'https://github.com/tailwindlabs/tailwindcss.com',
		branch: 'main',
		searchPath: 'src/docs',
		specialNotes: 'Tailwind CSS documentation.'
	},
	{
		name: 'hono',
		displayName: 'Hono',
		url: 'https://github.com/honojs/website',
		branch: 'main',
		searchPath: 'docs',
		specialNotes: 'Hono web framework documentation.'
	},
	{
		name: 'zod',
		displayName: 'Zod',
		url: 'https://github.com/colinhacks/zod',
		branch: 'main',
		searchPath: 'README.md',
		specialNotes: 'Zod schema validation library.'
	},
	{
		name: 'drizzle',
		displayName: 'Drizzle ORM',
		url: 'https://github.com/drizzle-team/drizzle-orm',
		branch: 'main',
		searchPath: 'docs',
		specialNotes: 'Drizzle ORM TypeScript documentation.'
	}
];

/**
 * Seed the global resources table with initial data
 * Run this once to populate the catalog
 */
export const seedGlobalResources = mutation({
	args: {},
	handler: async (ctx) => {
		// Check if already seeded
		const existing = await ctx.db.query('globalResources').first();
		if (existing) {
			return { message: 'Global resources already seeded', count: 0 };
		}

		let count = 0;
		for (const resource of INITIAL_GLOBAL_RESOURCES) {
			await ctx.db.insert('globalResources', {
				...resource,
				type: 'git',
				isActive: true
			});
			count++;
		}

		return { message: 'Seeded global resources', count };
	}
});
